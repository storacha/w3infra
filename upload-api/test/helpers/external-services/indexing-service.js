import { ok, error } from '@ucanto/core'
import { DecodeError, NetworkError } from '@storacha/indexing-service-client/errors'
import * as QueryResult from '@storacha/indexing-service-client/query-result'

/** @import * as API from '@storacha/upload-api' */

/**
 * Currently just a compatibility layer over content claims.
 *
 * @param {API.ClaimReader} claimReader
 * @returns {import('@storacha/indexing-service-client/api').IndexingServiceClient}
 */
export const create = (claimReader) => {
  return {
    /** @type {import('@storacha/indexing-service-client/api').IndexingServiceClient['queryClaims']} */
    async queryClaims (q) {
      if (q.hashes.length > 1) {
        throw new Error('multiple digests not implemented')
      }
      if (q.match) {
        throw new Error('space filtering not implemented')
      }

      const result = await claimReader.read(q.hashes[0])
      if (result.error) {
        return error(new NetworkError(result.error.message))
      }

      const queryResult = await QueryResult.from({ claims: result.ok })
      if (!queryResult.ok) {
        return error(new DecodeError())
      }
      return ok(queryResult.ok)
    }
  }
}
