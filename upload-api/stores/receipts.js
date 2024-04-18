import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import * as CAR from '@ucanto/transport/car'
import { CBOR, Message } from '@ucanto/core'
import pRetry from 'p-retry'
import { RecordNotFound, RecordNotFoundErrorName, StorageOperationFailed } from '@web3-storage/upload-api/errors'
import { getAgentMessage, getAgentMessageCidWithInvocation } from './lib.js'

/**
 * @typedef {import('@web3-storage/upload-api/types').ReceiptsStorage} ReceiptsStorage
 * @typedef {import('@ucanto/interface').Receipt} Receipt
 */

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * handled receipts. It follows pattern documented in
 * https://github.com/web3-storage/w3infra/blob/main/docs/ucan-invocation-stream.md#buckets
 *
 * @param {string} region
 * @param {string} taskBucketName
 * @param {string} invocationBucketName
 * @param {string} workflowBucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createReceiptsStorage(region, taskBucketName, invocationBucketName, workflowBucketName, options = {}) {
  const s3client = new S3Client({
    region,
    ...options,
  })
  return useReceiptsStorage(s3client, taskBucketName, invocationBucketName, workflowBucketName)
}

/**
 * @param {S3Client} s3client
 * @param {string} taskBucketName
 * @param {string} invocationBucketName
 * @param {string} workflowBucketName
 * @returns {ReceiptsStorage}
 */
export const useReceiptsStorage = (s3client, taskBucketName, invocationBucketName, workflowBucketName) => {
  return {
    /**
     * Creates an agent message to write the receipt received to be written.
     * Also write all indexes needed to lookup for receipt.
     * 
     * @param {Receipt} receipt
     */
    put: async (receipt) => {
      const message = await Message.build({
        receipts: [receipt]
      })
      const req = CAR.request.encode(message)
      const messageCid = message.root.cid
      const invocationCid = receipt.ran.link()
      const taskCid = invocationCid

      // Store workflow
      // The entire encoded agent message files containing receipt stored.
      const workflowPutCmd = new PutObjectCommand({
        Bucket: workflowBucketName,
        Key: `${messageCid}/${messageCid}`,
        Body: new Uint8Array(req.body.buffer),
      })

      // Store mapping for where each receipt lives in agent message file.
      // a pseudo symlink to `/${agentMessageArchive.cid}/${agentMessageArchive.cid}` via key 
      // `${invocation.cid}/${agentMessageArchive.cid}.out` to track where each receipt lives
      // in a agent message file. As a pseudo symlink, it is an empty object.
      const outLinkPutCmd = new PutObjectCommand({
        Bucket: invocationBucketName,
        Key: `${invocationCid}/${messageCid}.out`,
      })

      // Store mapping task to invocation 
      // a pseudo symlink to `/${invocation.cid}/${invocation.cid}` via 
      // `${task.cid}/${invocation.cid}.invocation` to enable looking up invocations and
      // receipts by a task. As a pseudo symlink, it is an empty object.
      const invocationLinkPutCmd = new PutObjectCommand({
        Bucket: taskBucketName,
        Key: `${taskCid}/${invocationCid}.invocation`,
      })

      // Store receipt output
      // A block containing the out field of the receipt. 
      const taskResult = await CBOR.write({
        out: receipt.out,
      })
      const receiptOutputPutCmd = new PutObjectCommand({
        Bucket: taskBucketName,
        Key: `${taskCid}/${taskCid}.result`,
        Body: taskResult.bytes,
      })

      try {
        await Promise.all([
          // see `src/ucan-invocation.js` on how we store workflows and tasks
          pRetry(() => s3client.send(workflowPutCmd)),
          pRetry(() => s3client.send(outLinkPutCmd)),
          pRetry(() => s3client.send(invocationLinkPutCmd)),
          pRetry(() => s3client.send(receiptOutputPutCmd)),
        ])
      } catch {
        return {
          error: new StorageOperationFailed('no new receipt should be put by storefront')
        }
      }

      return {
        ok: {}
      }
    },
    get: async (taskCid) => {
      // TODO: When we distinct between TaskCid and InvocationCid, we also need to see this mapping.
      const invocationCid = taskCid
      const getAgentMessageCid = await getAgentMessageCidWithInvocation(invocationCid, {
        invocationBucketName,
        s3client,
        endsWith: '.out'
      })
      if (getAgentMessageCid.error) {
        return getAgentMessageCid
      }
      const getAgentMessageRes = await getAgentMessage(getAgentMessageCid.ok, {
        workflowBucketName,
        s3client
      })
      if (getAgentMessageRes.error) {
        return getAgentMessageRes
      }

      // @ts-expect-error unknown link does not mach expectations
      const receipt = getAgentMessageRes.ok.receipts.get(taskCid.toString())
      if (!receipt) {
        return {
          error: new RecordNotFound(`agent message archive ${getAgentMessageCid.ok} does not include receipt for invocation ${taskCid.toString()}`)
        }
      }
      return {
        ok: receipt
      }
    },
    has: async (taskCid) => {
      // TODO: When we distinct between TaskCid and InvocationCid, we also need to see this mapping.
      const invocationCid = taskCid
      const getAgentMessageCid = await getAgentMessageCidWithInvocation(invocationCid, {
        invocationBucketName,
        s3client,
        endsWith: '.out'
      })
      if (getAgentMessageCid.error) {
        if (getAgentMessageCid.error.name === RecordNotFoundErrorName) {
          return {
            ok: false
          }
        }
        return getAgentMessageCid
      }

      const encodedAgentMessageArchiveKey = `${getAgentMessageCid.ok}/${getAgentMessageCid.ok}`
      const headCmd = new HeadObjectCommand({
        Bucket: workflowBucketName,
        Key: encodedAgentMessageArchiveKey,
      })

      let res
      try {
        res = await s3client.send(headCmd)
      } catch (/** @type {any} */ error) {
        if (error?.$metadata?.httpStatusCode === 404) {
          return {
            ok: false
          }
        }
        return {
          error: new StorageOperationFailed(error.message)
        }
      }
      if (!res) {
        return {
          error: new StorageOperationFailed(`Head request to check agent message existence failed`)
        }
      }
      return {
        ok: true
      }
    }
  }
}
