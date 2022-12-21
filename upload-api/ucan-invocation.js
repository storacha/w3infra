import * as CAR from '@ucanto/transport/car'
import * as UCAN from '@ipld/dag-ucan'
import * as Link from 'multiformats/link'

/**
 * @typedef {object} UcanInvocation
 * @property {UCAN.Capabilities} att
 * @property {`did:${string}:${string}`} aud
 * @property {`did:${string}:${string}`} iss
 * @property {string[]} prf
 * 
 * @typedef {object} UcanInvocationWrapper
 * @property {string} carCid
 * @property {Uint8Array} bytes
 * @property {UcanInvocation} value
 */

/**
 * Persist successful UCAN invocations handled by the router.
 *
 * @param {UcanInvocationWrapper} ucanInvocation
 * @param {import('@web3-storage/upload-api').UcanBucket} ucanStore
 */
export async function persistUcanInvocation(ucanInvocation, ucanStore) {
  await ucanStore.put(ucanInvocation.carCid, ucanInvocation.bytes)
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @returns {Promise<UcanInvocationWrapper>}
 */
export async function parseUcanInvocationRequest(request) {
  if (!request.body) {
    throw new Error('service requests are required to have body')
  }

  const bytes = Buffer.from(request.body, 'base64')
  const car = await CAR.codec.decode(bytes)
  const carCid = car.roots[0].cid.toString()

  // @ts-expect-error 'ByteView<unknown>' is not assignable to parameter of type 'ByteView<UCAN<Capabilities>>'
  const dagUcan = UCAN.decode(car.roots[0].bytes)

  return {
    bytes,
    carCid,
    value: {
      // Workaround for:
      // https://github.com/web3-storage/ucanto/issues/171
      // https://github.com/multiformats/js-multiformats/issues/228
      // @ts-ignore missing types
      att: dagUcan.att.map(replaceAllLinkValues),
      aud: dagUcan.aud.did(),
      iss: dagUcan.iss.did(),
      prf: replaceAllLinkValues(dagUcan.prf),
    },
  }
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
