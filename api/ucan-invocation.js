import * as CAR from '@ucanto/transport/car'

/**
 * Persist successful UCAN invocations handled by the router.
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @param {import('./service/types').UcanBucket} ucanStore 
 */
export async function persistUcanInvocation (request, ucanStore) {
  const { carCid, bytes } = await parseUcanInvocationRequest(request)

  await ucanStore.put(carCid, bytes)
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
export async function parseUcanInvocationRequest (request) {
  if (!request.body) {
    throw new Error('service requests are required to have body')
  }

  const bytes = Buffer.from(request.body, 'base64')
  const car = await CAR.codec.decode(bytes)
  const carCid = car.roots[0].cid.toString()

  return {
    bytes,
    carCid
  }
}
