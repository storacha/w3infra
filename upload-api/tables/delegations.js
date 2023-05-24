import * as CAR from '@ucanto/transport/car'
import { base32 } from 'multiformats/bases/base32'
import {
  DynamoDBClient,
  QueryCommand,
  BatchWriteItemCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'

import { CID } from 'multiformats/cid'
import {
  bytesToDelegations,
} from '@web3-storage/access/encoding'
// eslint-disable-next-line no-unused-vars
import * as Ucanto from '@ucanto/interface'
import {
  NoInvocationFoundForGivenReceiptError,
  NoCarFoundForGivenReceiptError,
} from '../errors.js'

/**
 * @typedef {Ucanto.Delegation} Delegation
 */

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {import('../types').DelegationsBucket} bucket
 * @param {import('../types').InvocationBucket} invocationBucket
 * @param {import('../types').WorkflowBucket} workflowBucket
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createDelegationsTable (region, tableName, bucket, invocationBucket, workflowBucket, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useDelegationsTable(dynamoDb, tableName, bucket, invocationBucket, workflowBucket)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @param {import('../types').DelegationsBucket} bucket
 * @param {import('../types').InvocationBucket} invocationBucket
 * @param {import('../types').WorkflowBucket} workflowBucket
 * @returns {import('@web3-storage/upload-api').DelegationsStorage}
 */
export function useDelegationsTable (dynamoDb, tableName, bucket, invocationBucket, workflowBucket) {
  return {
    putMany: async (cause, ...delegations) => {
      if (delegations.length === 0) {
        return {
          ok: {}
        }
      }
      await dynamoDb.send(new BatchWriteItemCommand({
        RequestItems: {
          [tableName]: delegations.map(d => ({
            PutRequest: {
              Item: marshall(
                createDelegationItem(cause, d),
                { removeUndefinedValues: true })
            }
          })
          )
        }
      }))
      // TODO: we should look at the return value of this BatchWriteItemCommand and either retry unprocessed items or return a Failure
      return {
        ok: {}
      }
    },

    count: async () => {
      const result = await dynamoDb.send(new DescribeTableCommand({
        TableName: tableName
      }))

      return BigInt(result.Table?.ItemCount ?? -1)
    },

    find: async (query) => {
      const cmd = new QueryCommand({
        TableName: tableName,
        // Limit: options.size || 20, // TODO should we introduce a limit here?
        KeyConditions: {
          audience: {
            ComparisonOperator: 'EQ',
            AttributeValueList: [{ S: query.audience }]
          }
        },
        AttributesToGet: ['link']
      })
      const response = await dynamoDb.send(cmd)

      const delegations = []
      for (const result of response.Items ?? []) {
        const { cause, link } = unmarshall(result)
        const delegationCid = CID.parse(link)
        if (cause) {
          delegations.push(await findDelegationInInvocation(
            invocationBucket, workflowBucket,
            CID.parse(cause), delegationCid
          ))
        } else {
          delegations.push(await cidToDelegation(bucket, delegationCid))
        }
      }
      return {
        ok: delegations
      }
    }
  }
}

/**
 * @param {Ucanto.Link} cause
 * @param {Delegation} d
 * @returns {{cause: string, link: string, audience: string, issuer: string}}}
 */
function createDelegationItem (cause, d) {
  return {
    cause: cause.toString(),
    link: d.cid.toString(),
    audience: d.audience.did(),
    issuer: d.issuer.did(),
  }
}

/** 
 * @param {import('../types').DelegationsBucket} bucket
 * @param {CID} cid
 * @returns {Promise<Ucanto.Delegation>}
 */
async function cidToDelegation (bucket, cid) {
  const delegationCarBytes = await bucket.get(cid)
  if (!delegationCarBytes) {
    throw new Error(`failed to read car bytes for cid ${cid.toString(base32)}`)
  }
  const delegations = bytesToDelegations(delegationCarBytes)
  const delegation = delegations.find((d) => d.cid.equals(cid))
  if (!delegation) {
    throw new Error(`failed to parse delegation with expected cid ${cid.toString(base32)}`)
  }
  return delegation
}

/** 
 * @param {import('../types').InvocationBucket} invocationBucket
 * @param {import('../types').WorkflowBucket} workflowBucket
 * @param {CID} invocationCid
 * @param {CID} delegationCid
 * @returns {Promise<Ucanto.Delegation>}
 */
async function findDelegationInInvocation (invocationBucket, workflowBucket, invocationCid, delegationCid) {

  // TODO is this right? I cargo culted some code from ucan-invocation.js and w3up/upload-api/src/access/delegate.js
  // but am not highly confident it works

  const invocationCidStr = invocationCid.toString()
  const agentMessageWithInvocationCid = await invocationBucket.getInLink(
    invocationCid.toString()
  )

  if (!agentMessageWithInvocationCid) {
    throw new NoCarFoundForGivenReceiptError()
  }

  const agentMessageBytes = await workflowBucket.get(
    agentMessageWithInvocationCid
  )
  if (!agentMessageBytes) {
    throw new NoCarFoundForGivenReceiptError()
  }

  const agentMessage = await CAR.request.decode({
    body: agentMessageBytes,
    headers: {},
  })
  const invocation = agentMessage.invocations.find(
    (inv) => inv.cid.toString() === invocationCidStr
  )

  if (!invocation) {
    throw new NoInvocationFoundForGivenReceiptError()
  }

  const proofDelegations = invocation.proofs.flatMap((proof) =>
    'capabilities' in proof ? [proof] : []
  )
  const foundDelegation = proofDelegations.find(proof => proof.cid)

  if (!foundDelegation) {
    throw new NoInvocationFoundForGivenReceiptError()
  }

  return foundDelegation
}