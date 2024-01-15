// Per https://developers.cloudflare.com/r2/api/s3/presigned-urls/
export const MAX_EXPIRES_IN = 3 * 24 * 60 * 60 // 7 days in seconds
export const MIN_EXPIRES_IN = 1
export const DEFAULT_EXPIRES_IN = 3 * 24 * 60 * 60 // 3 days in seconds by default

export const VALID_BUCKETS_BY_KEY = ['dagcargo']
export const VALID_R2_BUCKETS_DEFAULT = ['carpark-prod-0', 'carpark-prod-1', 'dagcargo']
export const VALID_S3_BUCKETS_DEFAULT = ['carpark-prod-0']
export const CF_R2_DOMAIN = 'fffa4b4363a7e5250af8357087263b3a.r2.cloudflarestorage.com'
export const AWS_S3_DOMAIN = 's3.amazonaws.com'

/**
 * Filters location claims to get the R2 buckets valid for redirect.
 * In case of not existing any R2 bucket, verifies if there is an AWS bucket name that could be attempted in CF.
 * 
 * @param {Set<string>} locations 
 * @param {object} [options]
 * @param {string[]} [options.validR2Buckets]
 * @param {string[]} [options.validS3Buckets]
 */
export function getBucketKeyPairToRedirect (locations, options = {}) {
  const validR2Buckets = options.validR2Buckets || VALID_R2_BUCKETS_DEFAULT
  const validS3Buckets = options.validS3Buckets || VALID_S3_BUCKETS_DEFAULT
  // Filter by Cloudflare R2 URLs
  const r2Urls = Array.from(locations)
    .filter(
      // CF Domain
      l => l.includes(CF_R2_DOMAIN) &&
      // Bucket name valid for CF
      validR2Buckets.filter(b => l.includes(b)).length
    )
  
  // Transform R2 URLs if existent
  if (r2Urls.length) {
    return r2Urls.map(url => {
      // Format https://account-id.r2.cloudflarestorage.com/bucket-name/key
      const domainSplit = url.split(CF_R2_DOMAIN)[1]
      const bucketName = domainSplit.split('/')[1]
      const key = domainSplit.split(`${bucketName}/`)[1]

      return {
        bucketName,
        key
      }
    })
  }

  // Attempt S3 URL to pick bucket to try in R2
  const s3Urls = Array.from(locations)
    .filter(
      // S3 Domain
      l => l.includes(AWS_S3_DOMAIN) &&
      // Bucket name valid for R2 attempt
      validS3Buckets.filter(b => l.includes(b)).length
    )
  
  // Transform S3 URLs if existent
  if (s3Urls.length) {
    return s3Urls.map(url => {
      // Format 'https://bucket-name.s3.amazonaws.com/key'
      const domainParts = url.split(`.${AWS_S3_DOMAIN}`)
      const bucketName = domainParts[0].replace('https://', '')
      const key = domainParts[1].slice(1)

      return {
        bucketName,
        key
      }
    })
  }

  return []
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventPathParameters | undefined} queryStringParameters
 */
export function parseQueryStringParameters (queryStringParameters) {
  const expiresIn = queryStringParameters?.expires ?
    parseInt(queryStringParameters?.expires) : DEFAULT_EXPIRES_IN
  
  if (expiresIn > MAX_EXPIRES_IN || expiresIn < MIN_EXPIRES_IN) {
    throw new Error(`Bad request with not acceptable expires parameter: ${queryStringParameters?.expires}`)
  }

  return {
    expiresIn
  }
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventPathParameters | undefined} queryStringParameters
 */
export function parseKeyQueryStringParameters (queryStringParameters) {
  const expiresIn = queryStringParameters?.expires ?
    parseInt(queryStringParameters?.expires) : DEFAULT_EXPIRES_IN
  
  if (expiresIn > MAX_EXPIRES_IN || expiresIn < MIN_EXPIRES_IN) {
    throw new Error(`Bad request with not acceptable expires parameter: ${queryStringParameters?.expires}`)
  }

  const bucketName = queryStringParameters?.bucket

  if (bucketName && !VALID_BUCKETS_BY_KEY.includes(bucketName)) {
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
    BUCKET_NAME: mustGetEnv('BUCKET_NAME'),
    BUCKET_ACCESS_KEY_ID: mustGetEnv('BUCKET_ACCESS_KEY_ID'),
    BUCKET_SECRET_ACCESS_KEY: mustGetEnv('BUCKET_SECRET_ACCESS_KEY')
  }
}

/**
 * 
 * @param {string} name 
 * @returns {string}
 */
function mustGetEnv (name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}
