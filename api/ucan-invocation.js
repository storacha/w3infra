import * as CAR from '@ucanto/transport/car'
import * as CBOR from '@ucanto/transport/cbor'

/**
 * @typedef {object} UcanInvocation
 * @property {any} att
 * 
 * @typedef {object} UcanInvocationWrapper
 * @property {string} carCid
 * @property {Uint8Array} bytes
 * @property {any} value
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

  const cbor = CBOR.codec.decode(car.roots[0].bytes)

  console.log('cbor', cbor)

  return {
    bytes,
    carCid,
    value: {
      // @ts-ignore
      att: cbor.att
    }
  }
}
