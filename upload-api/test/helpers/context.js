import anyTest from 'ava'

/**
 * @typedef {object} UcantoServerContext
 * @property {string} dbEndpoint
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 * @property {import('@aws-sdk/client-s3').S3Client} s3Client
 * @property {import('@aws-sdk/client-s3').ServiceInputTypes} s3ClientOpts
 * @property {import('@ucanto/principal/ed25519').EdSigner} serviceDid
 * @property {import('./resources').MockAccess} access
 * @property {string} accessServiceDID
 * @property {string} accessServiceURL
 * 
 * @typedef {object} UcanInvocationContext
 * @property {import('@aws-sdk/client-s3').S3Client} s3Client
 * @property {import('@aws-sdk/client-s3').ServiceInputTypes} s3ClientOpts
 * 
 * @typedef {import("ava").TestFn<Awaited<UcantoServerContext>>} TestStoreFn
 * @typedef {import("ava").TestFn<Awaited<UcanInvocationContext>>} TestUcanInvocationFn
 * @typedef {import("ava").TestFn<Awaited<any>>} TestAnyFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const testStore = /** @type {TestStoreFn} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testUcanInvocation = /** @type {TestUcanInvocationFn} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const test  = /** @type {TestAnyFn} */ (anyTest)
