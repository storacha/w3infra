import pRetry from 'p-retry'

/**
 * @template T
 * @param {() => Promise<import('../../filecoin/types').Result<T>>} fn
 * @param {(res: import('../../filecoin/types').Result<T>) => boolean} verifyResFn
 */
export async function waitForStoreOperationOkResult (fn, verifyResFn) {
  return await pRetry(async () => {
    const r = await fn()
    if (!verifyResFn(r)) {
      if (r.error) {
        throw r.error
      }
      throw new Error('result did not satisfy verifcation function')
    }

    return r
  }, {
    maxTimeout: 1000,
    minTimeout: 250,
    retries: 1e3
  })
}
