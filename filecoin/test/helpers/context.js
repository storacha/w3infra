import anyTest from 'ava'

/**
 * @typedef {object} QueueContext
 * @property {string} queueName
 * @property {string} queueUrl
 * @property {import('sqs-consumer').Consumer} queueConsumer
 *
 * @typedef {object} S3Context
 * @property {import('@aws-sdk/client-s3').S3Client} s3Client
 * @property {import('@aws-sdk/client-s3').ServiceInputTypes} s3Opts
 *
 * @typedef {object} DynamoContext
 * @property {string} dbEndpoint
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamoClient
 * 
 * @typedef {object} MultipleQueueContext
 * @property {import('@aws-sdk/client-sqs').SQSClient} sqsClient
 * @property {Record<string, QueueContext>} queues
 * @property {Map<string, unknown[]>} queuedMessages
 * 
 * @typedef {object} Stoppable
 * @property {() => Promise<any>} stop
 *
 * @typedef {import('ava').TestFn<Awaited<S3Context & DynamoContext>>} TestAnyFn
 * @typedef {import('ava').TestFn<Awaited<S3Context & DynamoContext & MultipleQueueContext & Stoppable>>} TestServiceFn
 * @typedef {import("ava").TestFn<Awaited<DynamoContext & S3Context>>} TestConsumerWithBucketFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const test  = /** @type {TestAnyFn} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testService  = /** @type {TestServiceFn} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testConsumerWithBucket = /** @type {TestConsumerWithBucketFn} */ (anyTest)
