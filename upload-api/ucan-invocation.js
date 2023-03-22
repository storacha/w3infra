import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'
import * as UCAN from '@ipld/dag-ucan'
import * as Link from 'multiformats/link'
import { fromString as uint8arrayFromString } from 'uint8arrays/from-string'

import {
  BadBodyError,
  BadContentTypeError,
  NoTokenError,
  ExpectedBasicStringError,
  NoValidTokenError,
  NoInvocationFoundForGivenReceiptError,
  NoCarFoundForGivenReceiptError
} from './errors.js'

export const CONTENT_TYPE = {
  INVOCATIONS: 'application/invocations+car',
  RECEIPT: 'application/receipt+dag-cbor'
}

/**
 * @typedef {import('./types').UcanLogCtx} UcanLogCtx
 * @typedef {import('./types').InvocationsCarCtx} InvocationsCarCtx
 * @typedef {import('./types').ReceiptBlockCtx} ReceiptBlockCtx
 * @typedef {import('./types').InvocationsCar} InvocationsCar
 * @typedef {import('./types').ReceiptBlock} ReceiptBlock
 */

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @param {UcanLogCtx} ctx
 */
export async function processUcanLogRequest (request, ctx) {
  const token = getTokenFromRequest(request)
  if (token !== ctx.basicAuth) {
    throw new NoValidTokenError('invalid Authorization credentials provided')
  }

  if (!request.body) {
    throw new BadBodyError('service requests are required to have body')
  }
  const bytes = Buffer.from(request.body, 'base64')

  const contentType = request.headers['Content-Type'] || ''
  if (contentType === CONTENT_TYPE.INVOCATIONS) {
    return await processInvocationsCar(bytes, ctx)
  } else if (contentType === CONTENT_TYPE.RECEIPT) {
    return await processReceiptCbor(bytes, ctx)
  }
  throw new BadContentTypeError()
}

/**
 * @param {Uint8Array} bytes
 * @param {InvocationsCarCtx} ctx
 */
export async function processInvocationsCar (bytes, ctx) {
  const invocationsCar = await parseInvocationsCar(bytes)

  // persist CAR and invocations
  await persistInvocationsCar(invocationsCar, ctx.storeBucket)

  // Put CAR invocations to UCAN stream
  await ctx.kinesisClient?.putRecords({
    Records: invocationsCar.invocations.map(invocation => ({
      Data: uint8arrayFromString(
        JSON.stringify({
          carCid: invocationsCar.cid.toString(),
          value: invocation,
          ts: Date.now(),
          type: CONTENT_TYPE.INVOCATIONS
        })
      ),
      // https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html
      // A partition key is used to group data by shard within a stream.
      // It is required, and now we are starting with one shard. We need to study best partition key
      PartitionKey: 'key',
    })),
    StreamName: ctx.streamName,
  })

  return invocationsCar
}

/**
 * @param {Uint8Array} bytes
 * @param {ReceiptBlockCtx} ctx
 */
export async function processReceiptCbor (bytes, ctx) {
  const receiptBlock = await parseReceiptCbor(bytes)
  const carBytes = await ctx.storeBucket.getCarBytesForInvocation(receiptBlock.data.ran.toString())
  if (!carBytes) {
    throw new NoCarFoundForGivenReceiptError()
  }

  const car = await parseInvocationsCar(carBytes)
  const invocation = car.invocations.find(invocation => invocation.cid.toString() === receiptBlock.data.ran.toString())
  if (!invocation) {
    throw new NoInvocationFoundForGivenReceiptError()
  }

  // persist receipt
  await persistReceipt(receiptBlock)

  // Put Receipt to UCAN Stream
  await ctx.kinesisClient?.putRecord({
    Data: uint8arrayFromString(
      JSON.stringify({
        carCid: car.cid.toString(),
        invocationCid: receiptBlock.cid.toString(),
        value: invocation,
        ts: Date.now(),
        type: CONTENT_TYPE.RECEIPT
      })
    ),
    // https://docs.aws.amazon.com/streams/latest/dev/key-concepts.html
    // A partition key is used to group data by shard within a stream.
    // It is required, and now we are starting with one shard. We need to study best partition key
    PartitionKey: 'key',
    StreamName: ctx.streamName,
  })

  return receiptBlock
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<InvocationsCar>}
 */
export async function parseInvocationsCar (bytes) {
  const car = await CAR.codec.decode(bytes)
  if (!car.roots.length) {
    throw new Error('Invocations CAR must have one root')
  }

  const cid = car.roots[0].cid

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
      cid: root.cid.toString()
    }
  })

  return {
    bytes,
    cid,
    invocations,
  }
}

/**
 * Persist CAR with handled UCAN invocations by the router.
 *
 * @param {InvocationsCar} invocationsCar
 * @param {import('./types').UcanBucket} ucanStore
 */
export async function persistInvocationsCar (invocationsCar, ucanStore) {
  const carCid = invocationsCar.cid.toString()
  const tasks = [
    ucanStore.putCar(carCid, invocationsCar.bytes),
    ...invocationsCar.invocations.map(i => ucanStore.putInvocation(i.cid, carCid))
  ]

  await Promise.all(tasks)
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<ReceiptBlock>}
 */
export async function parseReceiptCbor (bytes) {
  const data = await CBOR.codec.decode(bytes)
  const cid = await CBOR.codec.link(bytes)

  return {
    bytes,
    cid,
    data
  }
}

/**
 * @param {ReceiptBlock} receiptBlock
 * @param {import('./types').UcanBucket} [ucanStore]
 */
async function persistReceipt (receiptBlock, ucanStore) {
  await ucanStore?.putReceipt(
    receiptBlock.data.ran.toString(),
    receiptBlock.cid.toString(),
    receiptBlock.bytes
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
