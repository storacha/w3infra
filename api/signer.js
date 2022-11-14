import Signer from '@web3-storage/sigv4'
import { base64pad } from 'multiformats/bases/base64'

/**
 * @typedef {import('@ucanto/interface').Link<unknown, number, number, 0 | 1>} Link
 * @typedef {import('@web3-storage/sigv4').Types.SigV4Options} SigV4Options
 * 
 * @typedef {object} SignOptions
 * @property {string} bucket
 * @property {number} [expires=86400]
 * @property {string} [sessionToken]
 */

/**
 * @param {SigV4Options & SignOptions} ctx
 */
export function createSigner (ctx) {
  return {
    /**
     * @param {Link} link
     */
    sign: (link) => {
      const signer = new Signer({
        accessKeyId: ctx.accessKeyId,
        secretAccessKey: ctx.secretAccessKey,
        region: ctx.region,
      })
    
      const checksum = base64pad.baseEncode(link.multihash.digest)
    
      const url = signer.sign({
        key: `${link}/${link}.car`,
        checksum,
        bucket: ctx.bucket,
        expires: ctx.expires || 1000,
        sessionToken: ctx.sessionToken,
        publicRead: true,
      })
    
      return {
        url,
        headers: {
          'x-amz-checksum-sha256': checksum,
        },
      }
    }
  }
}
