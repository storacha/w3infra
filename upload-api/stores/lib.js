import { GetObjectCommand } from '@aws-sdk/client-s3'
import * as CAR from '@ucanto/transport/car'
import {
  RecordNotFound,
  StorageOperationFailed,
} from '@storacha/upload-api/errors'

/**
 * @param {string} messageCid
 * @param {object} props
 * @param {string} props.workflowBucketName
 * @param {import('@aws-sdk/client-s3').S3Client} props.s3client
 */
export async function getAgentMessage(
  messageCid,
  { workflowBucketName, s3client }
) {
  const encodedAgentMessageArchiveKey = `${messageCid}/${messageCid}`
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
        error: new RecordNotFound(
          `agent message archive ${encodedAgentMessageArchiveKey} not found in store`
        ),
      }
    }
    return {
      error: new StorageOperationFailed(error.message),
    }
  }
  if (!res || !res.Body) {
    return {
      error: new RecordNotFound(
        `agent message archive ${encodedAgentMessageArchiveKey} not found in store`
      ),
    }
  }

  const agentMessageBytes = await res.Body.transformToByteArray()
  const agentMessage = await CAR.request.decode({
    body: agentMessageBytes,
    headers: {},
  })

  return {
    ok: agentMessage,
  }
}
