// eslint-disable-next-line no-unused-vars
import { API, Message } from '@ucanto/core'
import * as CAR from '@ucanto/transport/car'

/**
 * @param {object} source
 * @param {API.IssuedInvocation[]} [source.invocations]
 * @param {API.Receipt[]} [source.receipts]
 */
export const encodeAgentMessage = async (source) => {
  const message = await Message.build({
    invocations: /** @type {API.Tuple<API.IssuedInvocation>} */ (
      source.invocations
    ),
    receipts: /** @type {API.Tuple<API.Receipt>} */ (source.receipts),
  })

  return await CAR.request.encode(message)
}
