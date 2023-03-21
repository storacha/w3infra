import * as CAR from '@ucanto/transport/car'
import * as UCAN from '@ipld/dag-ucan'
import * as Link from 'multiformats/link'
import { fromString as uint8arrayFromString } from 'uint8arrays/from-string'

import {
  NoTokenError,
  ExpectedBasicStringError,
  NoValidTokenError
} from './errors.js'

/**
 * @typedef {import('./types').UcanInvocation} UcanInvocation
 * @typedef {import('./types').InvocationsCar} InvocationsCar
 */

/**
 * Persist CAR with handled UCAN invocations by the router.
 *
 * @param {InvocationsCar} invocationsCar
 * @param {import('@web3-storage/upload-api').UcanBucket} ucanStore
 */
export async function persistInvocationsCar(invocationsCar, ucanStore) {
  await ucanStore.put(invocationsCar.cid, invocationsCar.bytes)
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @returns {Promise<InvocationsCar>}
 */
export async function parseInvocationsCarRequest(request) {
  if (!request.body) {
    throw new Error('service requests are required to have body')
  }

  const bytes = Buffer.from(request.body, 'base64')
  const car = await CAR.codec.decode(bytes)
  if (!car.roots.length) {
    throw new Error('Invocations CAR must have one root')
  }

  const cid = car.roots[0].cid.toString()

  const invocations = car.roots.map(root => {
    // @ts-expect-error 'ByteView<unknown>' is not assignable to parameter of type 'ByteView<UCAN<Capabilities>>'
    const dagUcan = UCAN.decode(root.bytes)

    return {
      // Workaround for:
      // https://github.com/web3-storage/ucanto/issues/171
      // https://github.com/multiformats/js-multiformats/issues/228
      // @ts-ignore missing types
      att: /** @type {UCAN.Capabilities} */ (dagUcan.att.map(replaceAllLinkValues)),
      aud: dagUcan.aud.did(),
      iss: dagUcan.iss.did(),
      prf: replaceAllLinkValues(dagUcan.prf),
    }
  })

  return {
    bytes,
    cid,
    invocations,
  }
}

/**
 * @param {InvocationsCar} invocationsCar
 * @param {string} ucanLogStreamName
 */
export function getKinesisInput (invocationsCar, ucanLogStreamName) {
  return {
    Records: invocationsCar.invocations.map(invocation => ({
      Data: uint8arrayFromString(
        JSON.stringify({
          carCid: invocationsCar.cid,
          value: invocation,
          ts: Date.now(),
        })
      ),
      // https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html
      // A partition key is used to group data by shard within a stream.
      // It is required, and now we are starting with one shard. We need to study best partition key
      PartitionKey: 'key',
    })),
    StreamName: ucanLogStreamName,
  }
}

/**
 * @typedef {object} UcanInvocationCtx
 * @property {import('@web3-storage/upload-api').UcanBucket} storeBucket
 * @property {string} basicAuth
 * @property {string} [streamName]
 * @property {import('@aws-sdk/client-kinesis').Kinesis} [kinesisClient]
 */

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @param {UcanInvocationCtx} ctx
 */
export async function processInvocationsCar(request, ctx) {
  const token = getTokenFromRequest(request)
  if (token !== ctx.basicAuth) {
    throw new NoValidTokenError('invalid Authorization credentials provided')
  }

  const car = await parseInvocationsCarRequest(request)

  // persist successful CAR handled
  await persistInvocationsCar(car, ctx.storeBucket)

  // Put CAR invocations to UCAN stream
  ctx.streamName && await ctx.kinesisClient?.putRecords(
    getKinesisInput(car, ctx.streamName)
  )
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
function getTokenFromRequest (request) {
  const authHeader = request.headers.Authorization || ''
  if (!authHeader) {
    throw new NoTokenError('no Authorization header provided')
  }

  const token = parseAuthorizationHeader(authHeader)
  return token
}

/**
 * @param {string} header
 */
function parseAuthorizationHeader (header) {
  if (!header.toLowerCase().startsWith('basic ')) {
    throw new ExpectedBasicStringError('no basic Authorization header provided')
  }

  return header.slice(6)
}

/**
 * @param {any} value
 */
export const replaceAllLinkValues = (value) => {
  // Array with Links?
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (Link.isLink(value[i])) {
        value[i] = toJSON(value[i])
      } else {
        replaceAllLinkValues(value[i])
      }
    }
  }
  // Object with Links?
  else if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (Link.isLink(value[key])) {
        value[key] = toJSON(value[key])
      }
      replaceAllLinkValues(value[key])
    }
  }

  return value
}

/**
 * @template {import('multiformats').UnknownLink} Link
 * @param {Link} link
 */
export const toJSON = (link) =>
  /** @type {import('@web3-storage/upload-api').LinkJSON<Link>} */ ({
    '/': link.toString(),
  })
