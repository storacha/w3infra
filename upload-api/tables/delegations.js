import { base32 } from 'multiformats/bases/base32'
import {
  DynamoDBClient,
  QueryCommand,
  BatchWriteItemCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
// eslint-disable-next-line no-unused-vars
import { CID } from 'multiformats/cid'
import {
  bytesToDelegations,
  delegationsToBytes
} from '@web3-storage/access/encoding'
// eslint-disable-next-line no-unused-vars
import * as Ucanto from '@ucanto/interface'
import { Failure } from '@ucanto/server'
import { CAR, Delegation, parseLink } from '@ucanto/core'
import {
  NoInvocationFoundForGivenCidError,
  NoDelegationFoundForGivenCidError,
  FailedToDecodeDelegationForGivenCidError
} from '../errors.js'


// Feature flag for looking up delegations in the invocations in which
// they were originally embeded.
// As of 6/6/2023 not all delegations have corresponding invocations
// because our access/confirm provider creates delegations.
// Once we change this, we can re-enable this optimization.
const FIND_DELEGATIONS_IN_INVOCATIONS = false

/**
 * @typedef {Ucanto.Delegation} Delegation
 */

/**
 * Abstraction layer to handle operations on Store Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} deps
 * @param {import('../types').DelegationsBucket} deps.bucket
 * @param {import('../types').InvocationBucket} deps.invocationBucket
 * @param {import('../types').WorkflowBucket} deps.workflowBucket
 * @param {object} [options]
 * @param {string} [options.endpoint]
 */
export function createDelegationsTable (region, tableName, { bucket, invocationBucket, workflowBucket }, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint,
  })

  return useDelegationsTable(dynamoDb, tableName, { bucket, invocationBucket, workflowBucket })
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @param {object} deps
 * @param {import('../types').DelegationsBucket} deps.bucket
 * @param {import('../types').InvocationBucket} deps.invocationBucket
 * @param {import('../types').WorkflowBucket} deps.workflowBucket
 * @returns {import('@web3-storage/upload-api').DelegationsStorage}
 */
export function useDelegationsTable (dynamoDb, tableName, { bucket, invocationBucket, workflowBucket }) {
  return {
    putMany: async (delegations, options = {}) => {
      if (delegations.length === 0) {
        return {
          ok: {}
        }
      }
      await writeDelegations(bucket, delegations)
      await dynamoDb.send(new BatchWriteItemCommand({
        RequestItems: {
          [tableName]: delegations.map(d => ({
            PutRequest: {
              Item: marshall(
                createDelegationItem(d, options.cause),
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
        IndexName: 'audience',
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
        const delegationCid = /** @type {Ucanto.Link} */ (parseLink(link))
        if (FIND_DELEGATIONS_IN_INVOCATIONS && cause) {
          // if this row has a cause, it is the CID of the invocation that contained these delegations
          // and we can pull them from there
          const invocationCid = /** @type {Ucanto.Link} */ (parseLink(cause))
          const result = await findDelegationInInvocation(
            {
              invocationBucket, workflowBucket,
              invocationCid, delegationCid
            }
          )
          if (result.ok) {
            delegations.push(result.ok)
          } else {
            return { error: new Failure(`could not find delegation ${delegationCid} from invocation ${invocationCid}`) }
          }
        } else {
          // otherwise, we'll try to find the delegation in the R2 bucket we used to stash them in
          const result = await cidToDelegation(bucket, delegationCid)
          if (result.ok){
            delegations.push(result.ok)
          } else {
            return {error: new Failure(`failed to get delegation ${delegationCid} from legacy delegations bucket`, {
              cause: result.error
            })}
          }
        }
      }
      return {
        ok: delegations
      }
    }
  }
}

/**
 * 
 * @param {import('../types').DelegationsBucket} bucket
 * @param {Ucanto.Delegation<Ucanto.Tuple<Ucanto.Capability>>[]} delegations
 */
async function writeDelegations (bucket, delegations) {
  return writeEntries(
    bucket,
    [...delegations].map((delegation) => {
      const carBytes = delegationsToBytes([delegation])
      const value = carBytes
      return /** @type {[key: CID, value: Uint8Array]} */ ([delegation.cid, value])
    })
  )
}

/**
 * 
 * @param {import('../types').DelegationsBucket} bucket
 * @param {Iterable<readonly [key: CID, value: Uint8Array ]>} entries
 */
async function writeEntries (bucket, entries) {
  await Promise.all([...entries].map(([key, value]) => bucket.put(key, value)))
}

/**
 * @param {Delegation} d
 * @param {Ucanto.Link | undefined} cause
 * @returns {{cause?: string, link: string, audience: string, issuer: string, expiration: number}}}
 */
function createDelegationItem (d, cause) {
  return {
    cause: cause?.toString(),
    link: d.cid.toString(),
    audience: d.audience.did(),
    issuer: d.issuer.did(),
    expiration: d.expiration
  }
}

/** 
 * @param {import('../types').DelegationsBucket} bucket
 * @param {Ucanto.Link} cid
 * @returns {Promise<Ucanto.Result<Ucanto.Delegation, Ucanto.Failure>>}
 */
async function cidToDelegation (bucket, cid) {
  const delegationCarBytes = await bucket.get(/** @type {import('multiformats/cid').CID} */(cid))
  if (!delegationCarBytes) {
    return { error: new Failure(`failed to read car bytes for cid ${cid.toString(base32)}`) }
  }
  const delegations = bytesToDelegations(delegationCarBytes)
  const delegation = delegations.find((d) => d.cid.equals(cid))
  if (!delegation) {
    return { error: new Failure(`failed to parse delegation with expected cid ${cid.toString(base32)}`) }
  }
  return { ok: delegation }
}

/** 
 * @typedef {NoInvocationFoundForGivenCidError | NoDelegationFoundForGivenCidError | FailedToDecodeDelegationForGivenCidError} FindDelegationError
 * @param {object} opts
 * @param {import('../types').InvocationBucket} opts.invocationBucket
 * @param {import('../types').WorkflowBucket} opts.workflowBucket
 * @param {Ucanto.UCANLink} opts.invocationCid
 * @param {Ucanto.Link} opts.delegationCid
 * @returns {Promise<Ucanto.Result<Ucanto.Delegation, FindDelegationError>>}
 */
async function findDelegationInInvocation ({ invocationBucket, workflowBucket, invocationCid, delegationCid }) {
  const agentMessageWithInvocationCid = await invocationBucket.getInLink(
    invocationCid.toString()
  )
  if (!agentMessageWithInvocationCid) {
    return { error: new NoInvocationFoundForGivenCidError() }
  }
  const agentMessageBytes = await workflowBucket.get(
    agentMessageWithInvocationCid
  )
  if (!agentMessageBytes) {
    return { error: new NoInvocationFoundForGivenCidError() }
  }
  const { blocks } = CAR.decode(agentMessageBytes)
  const delegation = Delegation.view({ blocks, root: delegationCid }, null)
  if (delegation === null) {
    return { error: new NoDelegationFoundForGivenCidError() }
  }
  try {
    // calling data here has the side effect of materializing the lazy data
    // @gozala recommended doing this but we should not need to in future versions of Ucanto
    // eslint-disable-next-line no-unused-expressions
    delegation.data
    return { ok: delegation }
  } catch {
    return { error: new FailedToDecodeDelegationForGivenCidError() }
  }
}
