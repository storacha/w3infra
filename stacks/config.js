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
 * Get nicer CDK resources name
 *
 * @param {string} name
 * @param {string} stage
 * @param {number} version
 */
export function getCdkNames (name, stage, version = 0) {
  // e.g `prod-w3infra-ucan-stream-delivery-0`
  return `${stage}-w3infra-${name}-${version}`
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
 * @param {import('sst/constructs').Stack} stack
 */
export function getEventSourceConfig (stack) {
  if (stack.stage !== 'prod') {
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
 * @param {import('sst/constructs').Stack} stack
 */
export function getKinesisStreamConfig (stack) {
  if (stack.stage !== 'prod' && stack.stage !== 'staging') {
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
  const pkg = require('./upload-api/package.json')
  return pkg
}

export function getGitInfo () {
  return {
    commmit: git.long('.'),
    branch: git.branch('.')
  }
}

/**
 * @param {import('sst/constructs').App} app
 * @param {import('sst/constructs').Stack} stack
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
 * @param {import('sst/constructs').Stack} stack
 * @param  {{domainName: string, hostedZone: string} | undefined} customDomain
 */
export function getServiceURL (stack, customDomain) {
  // in production we use the top level subdomain
  if (stack.stage === 'prod') {
    return 'https://up.web3.storage'
  // Derive from custom domain if there is one, which is used in staging, PR envs and dev envs
  } else if (customDomain) {
    return `https://${customDomain.domainName}`
  // everywhere else we use something more estoteric - usually an AWS Lambda URL
  } else {
    return process.env.ACCESS_SERVICE_URL
  }
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
    EIPFS_MULTIHASHES_SQS_ARN: mustGetEnv('EIPFS_MULTIHASHES_SQS_ARN'),
    EIPFS_MULTIHASHES_SQS_URL: mustGetEnv('EIPFS_MULTIHASHES_SQS_URL'),
    // Not required
    STOREFRONT_PROOF: process.env.STOREFRONT_PROOF ?? '',
    CONTENT_CLAIMS_PROOF: process.env.CONTENT_CLAIMS_PROOF ?? '',
    DISABLE_PIECE_CID_COMPUTE: process.env.DISABLE_PIECE_CID_COMPUTE ?? '',
    START_FILECOIN_METRICS_EPOCH_MS: process.env.START_FILECOIN_METRICS_EPOCH_MS ?? ''
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