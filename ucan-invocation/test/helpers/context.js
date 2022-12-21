import anyTest from 'ava'

/**
 * @typedef {object} TestContext
 * @property {import('@aws-sdk/client-s3').S3Client} s3Client
 *
 * @typedef {object} TestConsumerContext
 * @property {string} dbEndpoint
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 * 
 * @typedef {import("ava").TestFn<Awaited<TestContext>>} TestAnyFn
 * @typedef {import("ava").TestFn<Awaited<TestConsumerContext>>} TestConsumerFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const test  = /** @type {TestAnyFn} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testConsumer = /** @type {TestConsumerFn} */ (anyTest)
