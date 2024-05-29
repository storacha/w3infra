import { Kinesis } from '@aws-sdk/client-kinesis'
import { NoInvocationFoundForGivenReceiptError } from '../../errors.js'
import * as UTF8 from 'uint8arrays/from-string'
import * as API from '../../types.js'
import * as Store from './store.js'

export { API }

export const defaults = {
  workflow: { type: 'workflow' },
  receipt: { type: 'receipt' },

  // https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html
  // A partition key is used to group data by shard within a stream.
  // It is required, and now we are starting with one shard. We need to study best partition key
  partitionKey: 'key',
}

/**
 * @typedef {import('@aws-sdk/client-kinesis').KinesisClientConfig} Address
 * @typedef {Kinesis} Channel
 *
 * @typedef {API.Variant<{
 *   channel: Channel
 *   address: Address
 *   disable: {}
 * }>} Connection
 *
 * @typedef {object} Options
 * @property {Connection} connection
 * @property {string} name
 * @property {string} [partitionKey]
 * @property {{type:string}} [workflow]
 * @property {{type:string}} [receipt]
 *
 * @typedef {object} Stream
 * @property {Channel|null} channel
 * @property {string} name
 * @property {string} partitionKey
 * @property {{type:string}} workflow
 * @property {{type:string}} receipt
 */

/**
 * @param {Options} options
 * @returns {Stream}
 */
export const open = ({ connection, name, partitionKey, ...settings }) => ({
  ...settings,
  channel: connection.address
    ? new Kinesis(connection.address)
    : connection.channel ?? null,
  name,
  workflow: { ...defaults.workflow, ...settings.workflow },
  receipt: { ...defaults.receipt, ...settings.receipt },
  partitionKey: partitionKey ?? defaults.partitionKey,
})

/**
 *
 * @param {object} connection
 * @param {Store.Store} connection.store
 * @param {Stream} connection.stream
 * @param {API.ParsedAgentMessage} message
 * @returns {Promise<API.Result<API.Unit, Error>>}
 */
export const write = async (connection, message) => {
  const { stream } = connection

  try {
    if (stream.channel) {
      await stream.channel.putRecords({
        Records: await assert(message, connection),
        StreamName: connection.stream.name,
      })
    }
    return { ok: {} }
  } catch (cause) {
    return { error: /** @type {Error} */ (cause) }
  }
}

/**
 * Iterates over all invocations and receipts and yields corresponding kinesis
 * records.
 *
 * @param {API.ParsedAgentMessage} message
 * @param {object} connection
 * @param {Store.Store} connection.store
 * @param {Stream} connection.stream
 */
export const assert = async (message, { stream, store }) => {
  const records = []
  for (const member of message.index) {
    if (member.invocation) {
      const { task, invocation, message } = member.invocation
      records.push({
        Data: UTF8.fromString(
          JSON.stringify({
            // This is bad naming but not worth a breaking change
            carCid: message.toString(),
            task: task.toString(),
            value: {
              att: invocation.capabilities,
              aud: invocation.audience.did(),
              iss: invocation.issuer.did(),
              cid: invocation.cid.toString(),
            },
            ts: Date.now(),
            type: stream.workflow.type,
          })
        ),
        PartitionKey: stream.partitionKey,
      })
    }

    if (member.receipt) {
      const { task, receipt, message } = member.receipt
      // Prior implementation used to resolve the invocation and include it's
      // details the stream record. If invocation was not found it threw
      // exception which would result in HTTP status 500.

      // 🔬 Need to figure if there are consumers downstream that depend on
      // having invocation details in the stream record and whether we can
      // safely remove it because this additional IO which seems unnecessary.
      const { ok: invocation } = await Store.getInvocation(store, task)
      if (!invocation) {
        throw new NoInvocationFoundForGivenReceiptError()
      }

      records.push({
        Data: UTF8.fromString(
          JSON.stringify({
            // This is bad naming but not worth a breaking change
            carCid: message.toString(),
            task: task.toString(),
            value: {
              att: invocation.capabilities,
              aud: invocation.audience.did(),
              iss: invocation.issuer.did(),
              cid: invocation.cid.toString(),
            },
            out: receipt.out,
            ts: Date.now(),
            type: stream.receipt.type,
          })
        ),
        PartitionKey: stream.partitionKey,
      })
    }
  }

  return records
}
