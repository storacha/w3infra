import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3'
import * as CAR from '@ucanto/transport/car'
import { StoreOperationFailed, RecordNotFound } from '@web3-storage/filecoin-api/errors'

/**
 * Abstraction layer with Factory to perform operations on bucket storing
 * handled Tasks and their indexes.
 *
 * @param {string} region
 * @param {string} invocationBucketName
 * @param {string} workflowBucketName
 * @param {import('@aws-sdk/client-s3').ServiceInputTypes} [options]
 */
export function createTaskStore(region, invocationBucketName, workflowBucketName, options = {}) {
  const s3client = new S3Client({
    region,
    ...options,
  })
  return useTaskStore(s3client, invocationBucketName, workflowBucketName)
}

/**
 * @param {S3Client} s3client
 * @param {string} invocationBucketName
 * @param {string} workflowBucketName
 * @returns {import('@web3-storage/filecoin-api/storefront/api').TaskStore}
 */
export const useTaskStore = (s3client, invocationBucketName, workflowBucketName) => {
  return {
    put: async (record) => {
      return {
        error: new StoreOperationFailed('no new task should be put by storefront')
      }
    },
    get: async (taskCid) => {
      // TODO: When we distinct between TaskCid and InvocationCid, we also need to see this mapping.
      const invocationCid = taskCid

      // Find agent message archive CID where this receipt was stored
      const encodedInvocationKeyPrefix = `${invocationCid.toString()}/`
      const listCmd = new ListObjectsV2Command({
        Bucket: invocationBucketName,
        Prefix: encodedInvocationKeyPrefix
      })
      let listRes
      try {
        listRes = await s3client.send(listCmd)
      } catch (/** @type {any} */ error) {
        if (error?.$metadata?.httpStatusCode === 404) {
          return {
            error: new RecordNotFound(`any pseudo symlink from invocation ${invocationCid.toString()} was found`)
          }
        }
        return {
          error: new StoreOperationFailed(error.message)
        }
      }
      if (!listRes.Contents?.length) {
        return {
          error: new RecordNotFound(`any pseudo symlink from invocation ${invocationCid.toString()} was found`)
        }
      }

      // Key in format `${invocation.cid}/${agentMessageArchive.cid}.in`
      const agentMessageArchiveWithInvocation = listRes.Contents.find(c => c.Key?.endsWith('.in'))
      if (!agentMessageArchiveWithInvocation || !agentMessageArchiveWithInvocation.Key) {
        return {
          error: new RecordNotFound(`any pseudo symlink from invocation ${invocationCid.toString()} was found with a receipt`)
        }
      }

      // Get Message Archive with invocation
      const agentMessageArchiveWithInvocationCid = agentMessageArchiveWithInvocation.Key
        .replace(encodedInvocationKeyPrefix, '')
        .replace('.in', '')

      const encodedAgentMessageArchiveKey = `${agentMessageArchiveWithInvocationCid}/${agentMessageArchiveWithInvocationCid}`
      const getCmd = new GetObjectCommand({
        Bucket: workflowBucketName,
        Key: encodedAgentMessageArchiveKey,
      })

      let res
      try {
        res = await s3client.send(getCmd)
      } catch (/** @type {any} */ error) {
        if (error?.$metadata?.httpStatusCode === 404) {
          return {
            error: new RecordNotFound(`agent message archive ${encodedAgentMessageArchiveKey} not found in store`)
          }
        }
        return {
          error: new StoreOperationFailed(error.message)
        }
      }
      if (!res || !res.Body) {
        return {
          error: new RecordNotFound(`agent message archive ${encodedAgentMessageArchiveKey} not found in store`)
        }
      }

      // Get invocation from Message Archive
      const agentMessageBytes = await res.Body.transformToByteArray()
      const agentMessage = await CAR.request.decode({
        body: agentMessageBytes,
        headers: {},
      })

      const invocation = agentMessage.invocations.find(
        (invocation) => invocation.cid.toString() === invocationCid.toString()
      )
      if (!invocation) {
        return {
          error: new RecordNotFound(`agent message archive ${encodedAgentMessageArchiveKey} does not include invocation ${invocationCid.toString()}`)
        }
      }
      return {
        ok: invocation
      }
    },
    has: async (record) => {
      return {
        error: new StoreOperationFailed('no task should checked by storefront')
      }
    }
  }
}
