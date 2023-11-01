import { QueryCommand } from '@aws-sdk/client-dynamodb'
import { Schema } from '../../data/lib.js'
import { expect, mustGetEnv } from '../../functions/lib.js'
import { getConsumerBySpace, getDynamo, isValidDate } from './lib.js'
import { convertToAttr, unmarshall } from '@aws-sdk/util-dynamodb'
import { createSpaceSnapshotStore } from '../../tables/space-snapshot.js'

/**
 * @param {string} spaceParam
 * @param {string} datetime
 * @param {object} [options]
 * @param {boolean} [options.write]
 */
export const snapshotCreate = async (spaceParam, datetime, options) => {
  const space = Schema.did({ method: 'key' }).from(spaceParam)
  const to = new Date(datetime)
  if (!isValidDate(to)) {
    throw new Error('invalid datetime')
  }

  if (to.getTime() >= Date.now()) {
    throw new Error('cannot create snapshot for future date')
  }

  const dynamo = getDynamo()
  const consumer = await getConsumerBySpace(dynamo, space)

  let count = 0
  let size = 0n

  /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue>|undefined} */
  let lastKey
  while (true) {
    const res = await dynamo.send(new QueryCommand({
      TableName: mustGetEnv('STORE_TABLE_NAME'),
      Limit: 1000,
      KeyConditions: {
        space: {
          ComparisonOperator: 'EQ',
          AttributeValueList: [convertToAttr(space)]
        }
      },
      ExclusiveStartKey: lastKey
    }))
    if (!res.Items) throw new Error('missing items')

    const items = res.Items
      .map(i => unmarshall(i))
      .map(i => ({
        space: Schema.did({ method: 'key' }).from(i.space),
        size: BigInt(i.size),
        insertedAt: new Date(i.insertedAt)
      }))
      .filter(i => i.insertedAt.getTime() >= to.getTime())

    for (const i of items) {
      size += i.size
    }
    count += items.length

    if (!res.LastEvaluatedKey) {
      process.stdout.write('\n')
      break
    }
    lastKey = res.LastEvaluatedKey
    process.stdout.write('.')
  }

  if (options?.write) {
    const spaceSnapshotStore = createSpaceSnapshotStore(dynamo, {
      tableName: mustGetEnv('SPACE_SNAPSHOT_TABLE_NAME')
    })
    expect(
      await spaceSnapshotStore.put({
        space,
        provider: consumer.provider,
        size,
        recordedAt: to,
        insertedAt: new Date()
      }),
      'writing space snapshot'
    )
  }

  console.log({ ok: { space, provider: consumer.provider, size, count, recordedAt: to } })
}
