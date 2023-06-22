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
 * 
 * @typedef {object} RoundaboutContext
 * @property {string} roundaboutEndpoint
 *
 * @typedef {import("ava").TestFn<Awaited<Context>>} TestContextFn
 * @typedef {import("ava").TestFn<Awaited<RoundaboutContext>>} TestRoundaboutContextFn
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const test  = /** @type {TestContextFn} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testRoundabout  = /** @type {TestRoundaboutContextFn} */ (anyTest)
