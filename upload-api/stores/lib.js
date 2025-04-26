import {
  GetObjectCommand,
  ListObjectsV2Command
} from '@aws-sdk/client-s3'
import * as CAR from '@ucanto/transport/car'
import { RecordNotFound, StorageOperationFailed } from '@storacha/upload-api/errors'
import { GetItemCommand } from '@aws-sdk/client-dynamodb'

/**
 * @param {string} messageCid 
 * @param {object} props
 * @param {string} props.workflowBucketName
 * @param {import('@aws-sdk/client-s3').S3Client} props.s3client
 */
export async function getAgentMessage (messageCid, { workflowBucketName, s3client }) {
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
        error: new RecordNotFound(`agent message archive ${encodedAgentMessageArchiveKey} not found in store`)
      }
    }
    return {
      error: new StorageOperationFailed(error.message)
    }
  }
  if (!res || !res.Body) {
    return {
      error: new RecordNotFound(`agent message archive ${encodedAgentMessageArchiveKey} not found in store`)
    }
  }

  const agentMessageBytes = await res.Body.transformToByteArray()
  const agentMessage = await CAR.request.decode({
    body: agentMessageBytes,
    headers: {},
  })

  return {
    ok: agentMessage
  }
}



/**
 * @param {import('@ucanto/interface').UnknownLink} invocationCid 
 * @param {object} props
 * @param {string} props.dynamoDBTableName
 * @param {string} props.invocationBucketName
 * @param {import('@aws-sdk/client-s3').S3Client} props.s3client
 * @param {import('@aws-sdk/client-dynamodb').DynamoDB} props.dynamoDBClient
 * @param {'.out' | '.in'} props.endsWith
 */
export async function getAgentMessageCidWithInvocation (invocationCid, { dynamoDBTableName, invocationBucketName, s3client, dynamoDBClient, endsWith }) {
  const encodedInvocationKeyPrefix = `${invocationCid.toString()}/`

  // Find agent message archive CID where this receipt was stored
  // attempt to read first from dynamo
  const dynamoCommand = new GetItemCommand({
    TableName: dynamoDBTableName,
    Key: {
      "task": {
        S: encodedInvocationKeyPrefix
      },
      "kind": {
        S: endsWith.slice(1)
      }
    },
  })
  const { Item }= await dynamoDBClient.send(dynamoCommand)

  if (Item) {
    // Reassemble index entry -- invocation is nullable to support migration of legacy entrys in S3
    return { ok: Item.message.S }
  }

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
      error: new StorageOperationFailed(error.message)
    }
  }
  if (!listRes.Contents?.length) {
    return {
      error: new RecordNotFound(`any pseudo symlink from invocation ${invocationCid.toString()} was found`)
    }
  }
  // Key in format `${invocation.cid}/${agentMessageArchive.cid}.out`
  const agentMessageArchiveWithReceipt = listRes.Contents.find(c => c.Key?.endsWith(endsWith))
  if (!agentMessageArchiveWithReceipt || !agentMessageArchiveWithReceipt.Key) {
    return {
      error: new RecordNotFound(`any pseudo symlink from invocation ${invocationCid.toString()} was found with a receipt`)
    }
  }

  // Get Message Archive with receipt
  const agentMessageArchiveWithReceiptCid = agentMessageArchiveWithReceipt.Key
    .replace(encodedInvocationKeyPrefix, '')
    .replace(endsWith, '')
  
  return {
    ok: agentMessageArchiveWithReceiptCid
  }
}
