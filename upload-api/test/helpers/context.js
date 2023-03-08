import anyTest from 'ava'

/**
 * @typedef {object} DynamoContext
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @typedef {object} S3Context
 * @property {import('@aws-sdk/client-s3').S3Client} s3
 *
 * @typedef {import("ava").TestFn<DynamoContext & S3Context>} Test
 * @typedef {import("ava").TestFn<DynamoContext>} TestDynamo
 * @typedef {import("ava").TestFn<S3Context>} TestS3
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const s3 = /** @type {TestS3} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const dynamo = /** @type {TestDynamo} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const test = /** @type {Test} */ (anyTest)
