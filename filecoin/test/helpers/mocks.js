import * as Server from '@ucanto/server'

const notImplemented = () => {
  throw new Server.Failure('not implemented')
}

/**
 * @param {Partial<
 * { assert: Partial<import('@web3-storage/content-claims/server/service/api').AssertService> }
 * >} impl
 */
export function mockService(impl) {
 return {
    assert: {
      equals: withCallCount(impl.assert?.equals ?? notImplemented)
    }
 }
}

/**
 * @template {Function} T
 * @param {T} fn
 */
function withCallCount(fn) {
  /** @param {T extends (...args: infer A) => any ? A : never} args */
  const countedFn = (...args) => {
    countedFn.called = true
    countedFn.callCount++
    return fn(...args)
  }
  countedFn.called = false
  countedFn.callCount = 0
  return countedFn
}
