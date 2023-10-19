import { DynamoDBClient, PutItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import { Failure } from '@ucanto/server'

/**
 * @param {string} region 
 * @param {string} table
 * @param {object} [options]
 * @param {URL} [options.endpoint]
 */
export const createSpaceSizeSnapshotStore = (region, table, options) => {
  const dynamo = new DynamoDBClient({ region, endpoint: options?.endpoint?.toString() })
  return useSpaceSizeSnapshotStore(dynamo, table)
}

/**
 * @param {DynamoDBClient} dynamo 
 * @param {string} table
 * @returns {import('../types').SpaceSnapshotStore}
 */
export const useSpaceSizeSnapshotStore = (dynamo, table) => ({
  async put (input) {
    const cmd = new PutItemCommand({
      TableName: table,
      Item: marshall({
        space: `${input.space},${input.provider}`,
        size: input.size,
        recordedAt: input.recordedAt.getTime(),
        insertedAt: new Date().toISOString()
      })
    })
    await dynamo.send(cmd)
    return { ok: {} }
  },
  async getAfter (provider, space, after) {
    const cmd = new QueryCommand({
      TableName: table,
      Limit: 1,
      KeyConditions: {
        space: {
          ComparisonOperator: 'EQ',
          AttributeValueList: [{ S: `${space},${provider}` }]
        },
        recordedAt: {
          ComparisonOperator: 'GT',
          AttributeValueList: [{ S: after.toISOString() }]
        }
      }
    })
    const res = await dynamo.send(cmd)
    if (!res.Items || !res.Items.length) {
      return { error: new SpaceSnapshotNotFound(provider, space, after) }
    }

    /** @type {import('../types').SpaceSnapshotRecord[]} */
    const items = res.Items.map(item => {
      const raw = unmarshall(item)
      const [space, provider] = raw.space.split(',')
      return {
        provider,
        space,
        size: raw.size,
        recordedAt: new Date(raw.recordedAt),
        insertedAt: new Date(raw.insertedAt)
      }
    })

    return { ok: items[0] }
  }
})

export class SpaceSnapshotNotFound extends Failure {
  /**
   * @param {import('@ucanto/interface').DID} provider
   * @param {import('@ucanto/interface').DID} space
   * @param {Date} after
   */
  constructor (provider, space, after) {
    super()
    this.provider = provider
    this.space = space
    this.after = after
    this.name = /** @type {const} */ ('SpaceSnapshotNotFound')
  }

  describe () {
    return `space snapshot not found: ${this.space} for provider: ${this.provider}, after ${this.after.toISOString()}`
  }
}
