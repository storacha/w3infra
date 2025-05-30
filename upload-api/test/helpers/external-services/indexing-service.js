import { ok, error } from '@ucanto/core'
import { NetworkError } from '@storacha/indexing-service-client/errors'
import * as QueryResult from '@storacha/indexing-service-client/query-result'

/** @import * as API from '@storacha/upload-api' */

/**
 * Currently a union of indexing service and legacy content claims.
 *
 * @param {API.IndexingServiceAPI.Client} indexingService
 * @param {API.ClaimReader} claimReader
 * @returns {import('@storacha/indexing-service-client/api').IndexingServiceClient}
 */
export const create = (indexingService, claimReader) => {
  return {
    /** @type {import('@storacha/indexing-service-client/api').IndexingServiceClient['queryClaims']} */
    async queryClaims (q) {
      const res = await indexingService.queryClaims(q)
      if (res.error) return res
      if (res.ok.claims.size) return res

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

      const queryResult = await QueryResult.from({
        // @ts-expect-error location claim type renamed as location commitment
        // but otherwise compatible.
        claims: result.ok
      })
      if (!queryResult.ok) {
        // an error encoding the query result would be a 500 server error
        return error(
          /** @type {import('@storacha/indexing-service-client/api').NetworkError} */
          ({ ...queryResult.error, name: 'NetworkError' })
        )
      }
      return ok(queryResult.ok)
    }
  }
}
