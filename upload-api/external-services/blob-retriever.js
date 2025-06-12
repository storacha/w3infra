import { ok, error } from '@ucanto/core'
import { BlobNotFound } from '@storacha/upload-api/blob'
import * as Digest from 'multiformats/hashes/digest'
import { equals } from 'multiformats/bytes'

/**
 * @import * as API from '@storacha/upload-api'
 * @typedef {API.UnknownLink | { digest: Uint8Array }} LinkOrDigest
 * @typedef {{
 *   content: LinkOrDigest
 *   location: string[]
 *   range?: { offset: number, length?: number }
 * }} LocationCaveats
 */

/**
 * @param {import('@storacha/indexing-service-client/api').IndexingServiceClient} client
 * @returns {API.BlobRetriever}
 */
export const create = (client) => {
  return {
    /** @type {API.BlobRetriever['stream']} */
    async stream(digest) {
      let result
      try {
        result = await client.queryClaims({ hashes: [digest] })
        if (result.error) {
          // @ts-expect-error need to align blob retriever error types
          return result
        }
      } catch (/** @type {any} */ err) {
        console.error('queryclaimserr', err)
        throw err
      }

      for (const claim of result.ok.claims.values()) {
        if (claim.type === 'assert/location') {
          const contentDigest = toDigest(claim.content)
          if (equals(contentDigest.bytes, digest.bytes)) {
            const headers = new Headers()
            if (claim.range) {
              headers.set('Range', `bytes=${claim.range.offset}-${claim.range.length || ''}`)
            }
            try {
              const res = await fetch(claim.location[0], { headers })
              if (!res.body) throw new Error('missing response body')
              return ok(res.body)
            } catch (/** @type {any} */ err) {
              console.error('blobretrieveerr', claim.location, err)
              throw err
            }
          }
        }
      }
      return error(new BlobNotFound(digest))
    },
  }
}

/** @param {LinkOrDigest} input */
const toDigest = input =>
  'digest' in input ? Digest.decode(input.digest) : input.multihash
