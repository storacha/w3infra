import { mustGetEnv } from '../lib/env.js'
import { CAR_CODE } from './constants.js'

// Per https://developers.cloudflare.com/r2/api/s3/presigned-urls/
export const MAX_EXPIRES_IN = 3 * 24 * 60 * 60 // 7 days in seconds
export const MIN_EXPIRES_IN = 1
export const DEFAULT_EXPIRES_IN = 3 * 24 * 60 * 60 // 3 days in seconds by default

export const VALID_BUCKETS = ['dagcargo']

/** 
 * @typedef {import('multiformats/cid').CID} CID
 **/

/**
 * @param {import('aws-lambda').APIGatewayProxyEventPathParameters | undefined} queryStringParameters
 */
export function parseQueryStringParameters (queryStringParameters) {
  const expiresIn = queryStringParameters?.expires ?
    parseInt(queryStringParameters?.expires) : DEFAULT_EXPIRES_IN
  
  if (expiresIn > MAX_EXPIRES_IN || expiresIn < MIN_EXPIRES_IN) {
    throw new Error(`Bad request with not acceptable expires parameter: ${queryStringParameters?.expires}`)
  }

  const bucketName = queryStringParameters?.bucket

  if (bucketName && !VALID_BUCKETS.includes(bucketName)) {
    throw new Error(`Bad requested with not acceptable bucket: ${bucketName}`)
  }

  return {
    expiresIn,
    bucketName
  }
}

/**
 * Get Env validating it is set.
 */
export function getEnv() {
  return {
    BUCKET_ENDPOINT: mustGetEnv('BUCKET_ENDPOINT'),
    BUCKET_REGION: mustGetEnv('BUCKET_REGION'),
    BUCKET_ACCESS_KEY_ID: mustGetEnv('BUCKET_ACCESS_KEY_ID'),
    BUCKET_SECRET_ACCESS_KEY: mustGetEnv('BUCKET_SECRET_ACCESS_KEY'),
    BUCKET_NAME: mustGetEnv('BUCKET_NAME')
  }
}

/**
 * Return the cid if it is a CAR CID or undefined if not
 *
 * @param {CID} cid
 */
export function asCarCid(cid) {
  if (cid.code === CAR_CODE) {
    return cid
  }
}

