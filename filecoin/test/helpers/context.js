import anyTest from 'ava'

/**
 * @typedef {object} S3Context
 * @property {import('@aws-sdk/client-s3').S3Client} s3Client
 * @property {import('@aws-sdk/client-s3').ServiceInputTypes} s3Opts
 *
 * @typedef {object} DynamoContext
 * @property {string} dbEndpoint
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 *
 * @typedef {import("ava").TestFn<Awaited<S3Context & DynamoContext>>} TestAnyFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const test  = /** @type {TestAnyFn} */ (anyTest)
