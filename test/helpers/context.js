import anyTest from 'ava'
import dotenv from 'dotenv'

dotenv.config({
  path: '.env.local'
})

/**
 * @typedef {object} Dynamo
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClient} client
 * @property {string} endpoint
 * @property {string} region
 * @property {string} tableName
 *
 * @typedef {object} Context
 * @property {string} apiEndpoint
 * @property {Dynamo} metricsDynamo
 * @property {Dynamo} spaceMetricsDynamo
 * @property {Dynamo} rateLimitsDynamo
 * 
 * @typedef {object} RoundaboutContext
 * @property {string} roundaboutEndpoint
 * 
 * @typedef {object} FilecoinContext
 * @property {Dynamo} pieceDynamo
 * @property {string} apiEndpoint
 * 
 * @typedef {object} BlobContext
 * @property {string} apiEndpoint
 * @property {string} roundaboutEndpoint
 *
 * @typedef {import("ava").TestFn<Awaited<Context>>} TestContextFn
 * @typedef {import("ava").TestFn<Awaited<RoundaboutContext>>} TestRoundaboutContextFn
 * @typedef {import("ava").TestFn<Awaited<FilecoinContext>>} TestFilecoinContextFn
 * @typedef {import("ava").TestFn<Awaited<BlobContext>>} TestBlobContextFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const test  = /** @type {TestContextFn} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testRoundabout  = /** @type {TestRoundaboutContextFn} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testFilecoin  = /** @type {TestFilecoinContextFn} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testBlob  = /** @type {TestBlobContextFn} */ (anyTest)

