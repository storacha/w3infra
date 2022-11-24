import anyTest from 'ava'

/**
 * @typedef {import("ava").TestFn<Awaited<any>>} TestAnyFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const test  = /** @type {TestAnyFn} */ (anyTest)
