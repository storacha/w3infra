
import { trace } from '@opentelemetry/api'
import { PutItemCommand, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb'
import { convertToAttr, marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import * as Link from 'multiformats/link'
import { base58btc } from 'multiformats/bases/base58'
import * as Digest from 'multiformats/hashes/digest'
import { getDynamoClient } from '../../lib/aws/dynamo.js'
import { parse } from '@ipld/dag-ucan/did'
import { ok, error } from '@ucanto/core'
import { instrumentMethods } from '../lib/otel/instrument.js'

const tracer = trace.getTracer('upload-api')

/** @import * as API from '@storacha/upload-api' */

/**
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {API.BlobAPI.ReplicaStorage}
 */
export const createReplicaTable = (region, tableName, options) => {
  const dynamo = getDynamoClient({ region, endpoint: options?.endpoint })
  return useReplicaTable(dynamo, tableName)
}

/**
 * @param {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @param {string} tableName
 * @returns {API.BlobAPI.ReplicaStorage}
 */
export const useReplicaTable = (dynamo, tableName) =>
  instrumentMethods(tracer, 'ReplicaTable', {
    /** @type {API.BlobAPI.ReplicaStorage['add']} */
    async add (data) {
      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall({
          pk: encodePartitionKey(data),
          space: data.space,
          digest: base58btc.encode(data.digest.bytes),
          provider: data.provider,
          status: data.status,
          cause: data.cause.toString(),
          createdAt: new Date().toISOString()
        }),
        ConditionExpression: 'attribute_not_exists(#PK)',
        ExpressionAttributeNames: { '#PK': 'pk' }
      })
      try {
        await dynamo.send(cmd)
      } catch (/** @type {any} */ err) {
        if (err.name === 'ConditionalCheckFailedException') {
          return error({
            name: 'ReplicaExists',
            message: 'A replica for this space and digest already exists'
          })
        }
        return error(err)
      }
      return ok({})
    },


    /** @type {API.BlobAPI.ReplicaStorage['retry']} */
    async retry (data) {
      const cmd = new UpdateItemCommand({
        TableName: tableName,
        Key: marshall({ pk: encodePartitionKey(data), provider: data.provider }),
        UpdateExpression: 'SET #S = :s, #C = :c, updatedAt = :t',
        ExpressionAttributeNames: { '#S': 'status', '#C': 'cause' },
        ExpressionAttributeValues: {
          ':s': convertToAttr(data.status),
          ':c': convertToAttr(data.cause.toString()),
          ':t': convertToAttr(new Date().toISOString())
        },
      })
      try {
        await dynamo.send(cmd)
      } catch (/** @type {any} */ err) {
        return error(err)
      }
      return ok({})
    },

    /** @type {API.BlobAPI.ReplicaStorage['setStatus']} */
    async setStatus (key, status) {
      const cmd = new UpdateItemCommand({
        TableName: tableName,
        Key: marshall({ pk: encodePartitionKey(key), provider: key.provider }),
        UpdateExpression: 'SET #S = :s, updatedAt = :t',
        ExpressionAttributeNames: { '#S': 'status' },
        ExpressionAttributeValues: {
          ':s': convertToAttr(status),
          ':t': convertToAttr(new Date().toISOString())
        },
      })
      try {
        await dynamo.send(cmd)
      } catch (/** @type {any} */ err) {
        return error(err)
      }
      return ok({})
    },

    /** @type {API.BlobAPI.ReplicaStorage['list']} */
    async list (filter) {
      /** @type {API.BlobAPI.Replica[]} */
      const replicas = []
      /** @type {Record<string, import('@aws-sdk/client-dynamodb').AttributeValue>|undefined} */
      let cursor
      while (true) {
        const cmd = new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: {
            ':pk': convertToAttr(encodePartitionKey(filter)),
          },
          ExclusiveStartKey: cursor
        })
        const res = await dynamo.send(cmd)
        for (const item of res.Items ?? []) {
          const raw = unmarshall(item)
          replicas.push({
            space: raw.space,
            digest: Digest.decode(base58btc.decode(raw.digest)),
            provider: parse(raw.provider).did(),
            status: raw.status,
            cause: Link.parse(raw.cause)
          })
        }
        cursor = res.LastEvaluatedKey
        if (!cursor) break
      }
      return ok(replicas)
    }
  })

/** @param {{ space: API.DID, digest: API.MultihashDigest }} input */
const encodePartitionKey = ({ space, digest }) =>
  `${space}#${base58btc.encode(digest.bytes)}`
