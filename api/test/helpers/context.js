import anyTest from 'ava'

/**
 * @typedef {object} StoreContext
 * @property {string} dbEndpoint
 * @property {string} tableName
 * @property {string} region
 * @property {string} bucketName
 * @property {import('@aws-sdk/client-s3')} s3Client
 * @property {import('@aws-sdk/client-s3').ServiceInputTypes} s3ClientOpts
 * @property {import('@ucanto/principal/ed25519').EdSigner} serviceDid
 * 
 * @typedef {import("ava").TestFn<Awaited<ReturnType<StoreContext>>>} TestStoreFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const testStore = /** @type {TestStoreFn} */ (anyTest)
