import anyTest from 'ava'

/**
 * @typedef {object} TestContext
 * @property {import('@aws-sdk/client-s3').S3Client} s3Client
 *
 * @typedef {object} TestConsumerContext
 * @property {string} dbEndpoint
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 * 
 * @typedef {object} S3Context
 * @property {import('@aws-sdk/client-s3').S3Client} s3
 * @property {import('@aws-sdk/client-s3').ServiceInputTypes} s3Opts
 * 
 * @typedef {import("ava").TestFn<Awaited<TestContext>>} TestAnyFn
 * @typedef {import("ava").TestFn<Awaited<TestConsumerContext>>} TestConsumerFn
 * @typedef {import("ava").TestFn<Awaited<TestConsumerContext & S3Context>>} TestConsumerWithBucketFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const test  = /** @type {TestAnyFn} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testConsumer = /** @type {TestConsumerFn} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testConsumerWithBucket = /** @type {TestConsumerWithBucketFn} */ (anyTest)
