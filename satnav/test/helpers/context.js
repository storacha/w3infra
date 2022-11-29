import anyTest from 'ava'

/**
 * @typedef {object} Context
 * @property {import('@aws-sdk/client-s3').S3Client} s3Client
 *
 * @typedef {import("ava").TestFn<Awaited<Context>>} TestAnyFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const test  = /** @type {TestAnyFn} */ (anyTest)
