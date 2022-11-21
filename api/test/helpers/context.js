import anyTest from 'ava'

/**
 * @typedef {object} UcantoServerContext
 * @property {string} dbEndpoint
 * @property {string} tableName
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 * @property {string} region
 * @property {string} bucketName
 * @property {import('@aws-sdk/client-s3').S3Client} s3Client
 * @property {import('@aws-sdk/client-s3').ServiceInputTypes} s3ClientOpts
 * @property {import('@ucanto/principal/ed25519').EdSigner} serviceDid
 * @property {import('../utils').MockAccess} access
 * @property {string} accessServiceDID
 * @property {string} accessServiceURL
 * 
 * @typedef {import("ava").TestFn<Awaited<UcantoServerContext>>} TestStoreFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const testStore = /** @type {TestStoreFn} */ (anyTest)
