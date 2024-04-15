import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import * as CAR from '@ucanto/transport/car'
import { Message } from '@ucanto/core'
import pRetry from 'p-retry'
import { StorageOperationFailed, RecordNotFound, RecordNotFoundErrorName } from '@web3-storage/upload-api/errors'
import { getAgentMessage, getAgentMessageCidWithInvocation } from './lib.js'

/**
 * @typedef {import('@web3-storage/upload-api/types').TasksStorage} TasksStorage
 * @typedef {import('@web3-storage/capabilities/types').StorageGetError} StorageGetError
 * @typedef {import('@web3-storage/capabilities/types').StoragePutError} StoragePutError
 * @typedef {import('@ucanto/interface').UnknownLink} UnknownLink
 * @typedef {import('@ucanto/interface').Invocation} Invocation
 */

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * handled receipts. It follows pattern documented in
 * https://github.com/web3-storage/w3infra/blob/main/docs/ucan-invocation-stream.md#buckets
 *
 * @param {string} region
 * @param {string} invocationBucketName
 * @param {string} workflowBucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createTasksStorage(region, invocationBucketName, workflowBucketName, options = {}) {
  const s3client = new S3Client({
    region,
    ...options,
  })
  return useTasksStorage(s3client, invocationBucketName, workflowBucketName)
}

/**
 * @param {S3Client} s3client
 * @param {string} invocationBucketName
 * @param {string} workflowBucketName
 * @returns {TasksStorage}
 */
export const useTasksStorage = (s3client, invocationBucketName, workflowBucketName) => {
  return {
    /**
     * Creates an agent message to write the invocation received to be written.
     * Also write all indexes needed to lookup for invocation.
     * 
     * @param {Invocation} invocation
     */
    put: async (invocation) => {
      const message = await Message.build({
        invocations: [invocation]
      })
      const req = CAR.request.encode(message)
      const messageCid = message.root.cid
      const invocationCid = invocation.cid

      // Store workflow
      // The entire encoded agent message files containing invocations to be executed.
      const workflowPutCmd = new PutObjectCommand({
        Bucket: workflowBucketName,
        Key: `${messageCid}/${messageCid}`,
        Body: new Uint8Array(req.body.buffer),
      })
      // Store mapping for where each receipt lives in agent message file.
      // A pseudo symlink to `/${agentMessageArchive.cid}/${agentMessageArchive.cid}` via key
      // `${invocation.cid}/${agentMessageArchive.cid}`.in to track where each invocation lives
      // in a agent message file. As a pseudo symlink, it is an empty object.
      const inLinkPutCmd = new PutObjectCommand({
        Bucket: invocationBucketName,
        Key: `${invocationCid}/${messageCid}.in`,
      })

      try {
        await Promise.all([
          // see `src/ucan-invocation.js` on how we store workflows and tasks
          pRetry(() => s3client.send(workflowPutCmd)),
          pRetry(() => s3client.send(inLinkPutCmd)),
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
        endsWith: '.in'
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

      const invocation = getAgentMessageRes.ok.invocations.find(inv => inv.cid.equals(taskCid))
      if (!invocation) {
        return {
          error: new RecordNotFound(),
        }
      }
      return {
        ok: invocation
      }
    },
    has: async (taskCid) => {
      // TODO: When we distinct between TaskCid and InvocationCid, we also need to see this mapping.
      const invocationCid = taskCid
      const getAgentMessageCid = await getAgentMessageCidWithInvocation(invocationCid, {
        invocationBucketName,
        s3client,
        endsWith: '.in'
      })
      if (getAgentMessageCid.error) {
        if (getAgentMessageCid.error.name === RecordNotFoundErrorName) {
          return {
            ok: false
          }
        }
        return getAgentMessageCid
      }

      const getAgentMessageRes = await getAgentMessage(getAgentMessageCid.ok, {
        workflowBucketName,
        s3client
      })
      if (getAgentMessageRes.error) {
        return getAgentMessageRes
      }

      const invocation = getAgentMessageRes.ok.invocations.find(inv => inv.cid.equals(taskCid))
      if (!invocation) {
        return {
          ok: false
        }
      }
      return {
        ok: true
      }
    }
  }
}
