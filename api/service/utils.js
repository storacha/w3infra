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
 * @param {Link} link
 * @param {SigV4Options & SignOptions} options
 */
 export const createSignedUrl = (link, { bucket, expires = 1000, ...options }) => {
  const signer = new Signer({
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region,
  })

  const checksum = base64pad.baseEncode(link.multihash.digest)

  const url = signer.sign({
    key: `${link}/${link}.car`,
    checksum: checksum,
    bucket,
    expires,
    sessionToken: options.sessionToken,
    publicRead: true,
  })

  return {
    url,
    headers: {
      'x-amz-checksum-sha256': checksum,
    },
  }
}
