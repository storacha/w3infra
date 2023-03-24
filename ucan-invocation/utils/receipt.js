import { STREAM_TYPE } from '../constants.js'

/**
 * 
 * @param {import('../types').UcanInvocation} ucanInvocation 
 */
export function hasOkReceipt (ucanInvocation) {
  return ucanInvocation.type === STREAM_TYPE.RECEIPT && Boolean(ucanInvocation.out?.ok)
}
