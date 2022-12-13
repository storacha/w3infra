import * as CAR from '@ucanto/transport/car'
import * as UCAN from '@ipld/dag-ucan'

/**
 * @typedef {object} UcanInvocation
 * @property {UCAN.Capabilities} att
 * @property {`did:${string}:${string}`} aud
 * @property {`did:${string}:${string}`} iss
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
 * @param {import('./service/types').UcanBucket} ucanStore 
 */
export async function persistUcanInvocation (ucanInvocation, ucanStore) {
  await ucanStore.put(ucanInvocation.carCid, ucanInvocation.bytes)
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @returns {Promise<UcanInvocationWrapper>}
 */
export async function parseUcanInvocationRequest (request) {
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
      att: dagUcan.att,
      aud: dagUcan.aud.did(),
      iss: dagUcan.iss.did()
    }
  }
}
