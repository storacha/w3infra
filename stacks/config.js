import { Duration, RemovalPolicy } from 'aws-cdk-lib'
import { createRequire } from 'module'
import { StartingPosition } from 'aws-cdk-lib/aws-lambda'
import git from 'git-rev-sync'

/**
 * Get nicer bucket names
 *
 * @param {string} name
 * @param {string} stage
 * @param {number} version
 */
export function getBucketName (name, stage, version = 0) {
  // e.g `carpark-prod-0` or `satnav-pr101-0`
  return `${name}-${stage}-${version}`
}

/**
 * Is an ephemeral build?
 *
 * @param {string} stage
 */
export function isPrBuild (stage) {
  if (!stage) throw new Error('stage must be provided')
  return stage !== 'prod' && stage !== 'staging'
}

/**
 * @param {string} name
 * @param {string} stage
 * @param {number} version
 */
export function getBucketConfig(name, stage, version = 0){
  return {
    bucketName: getBucketName(name, stage, version),
    ...(isPrBuild(stage) && {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY
    })
  }
}

/**
 * Return the custom domain config for http api
 * 
 * @param {string} stage
 * @param {string | undefined} hostedZone
 * @returns {{domainName: string, hostedZone: string} | undefined}
 */
export function getCustomDomain (stage, hostedZone) {
  // return no custom domain config if hostedZone not set
  if (!hostedZone) {
    return 
  }
  /** @type Record<string,string> */
  const domainMap = { prod: hostedZone }
  const domainName = domainMap[stage] ?? `${stage}.${hostedZone}`
  return { domainName, hostedZone }
}

/**
 * @param {import('@serverless-stack/resources').Stack} stack
 */
export function getKinesisEventSourceConfig (stack) {
  if (stack.stage !== 'production') {
    return {
      batchSize: 10,
      // The maximum amount of time to gather records before invoking the function.
      maxBatchingWindow: Duration.seconds(5),
      // If the function returns an error, split the batch in two and retry.
      bisectBatchOnError: true,
      // Where to begin consuming the stream.
      startingPosition: StartingPosition.LATEST
    }
  }

  return {
    // Dynamo Transactions allow up to 100 writes per transactions. If we allow 10 capabilities executed per request, we can have up to 100.
    // TODO: we use bisectBatchOnError, so maybe we can attempt bigger batch sizes to be optimistic?
    batchSize: 10,
    // The maximum amount of time to gather records before invoking the function.
    maxBatchingWindow: Duration.minutes(2),
    // If the function returns an error, split the batch in two and retry.
    bisectBatchOnError: true,
    // Where to begin consuming the stream.
    startingPosition: StartingPosition.TRIM_HORIZON
  }
}

/**
 * @param {import('@serverless-stack/resources').Stack} stack
 */
export function getKinesisStreamConfig (stack) {
  if (stack.stage !== 'production') {
    return {
      retentionPeriod: Duration.hours(24)
    }
  }

  return {
    retentionPeriod: Duration.days(365)
  }
}

export function getApiPackageJson () {
  // @ts-expect-error ts thinks this is unused becuase of the ignore
  const require = createRequire(import.meta.url)
  // @ts-ignore ts dont see *.json and dont like it
  const pkg = require('../../upload-api/package.json')
  return pkg
}

export function getGitInfo () {
  return {
    commmit: git.long('.'),
    branch: git.branch('.')
  }
}

/**
 * @param {import('@serverless-stack/resources').App} app
 * @param {import('@serverless-stack/resources').Stack} stack
 */
export function setupSentry (app, stack) {
  // Skip when locally
  if (app.local) {
    return
  }

  const { SENTRY_DSN } = getEnv()

  stack.addDefaultFunctionEnv({
    SENTRY_DSN,
  })
}

/**
 * Get Env validating it is set.
 */
export function getEnv() {
  return {
    SENTRY_DSN: mustGetEnv('SENTRY_DSN'),
    UPLOAD_API_DID: mustGetEnv('UPLOAD_API_DID'),
    AGGREGATOR_DID: mustGetEnv('AGGREGATOR_DID'),
    AGGREGATOR_URL: mustGetEnv('AGGREGATOR_URL'),
    CONTENT_CLAIMS_DID: mustGetEnv('CONTENT_CLAIMS_DID'),
    CONTENT_CLAIMS_URL: mustGetEnv('CONTENT_CLAIMS_URL'),
    // Not required
    CONTENT_CLAIMS_PROOF: process.env.CONTENT_CLAIMS_PROOF ?? ''
  }
}

/**
 * 
 * @param {string} name 
 * @returns {string}
 */
function mustGetEnv (name) {
  if (!process.env[name]) {
    throw new Error(`Missing env var: ${name}`)
  }

  // @ts-expect-error there will always be a string there, but typescript does not believe
  return process.env[name]
}