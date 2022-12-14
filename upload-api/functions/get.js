import * as Sentry from '@sentry/serverless'
import { Config } from '@serverless-stack/node/config/index.js'

import { getServiceSigner } from '../config.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

/**
 * AWS HTTP Gateway handler for GET /version
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request 
 */
 export async function versionGet (request) {
  const { NAME: name , VERSION: version, COMMIT: commit, STAGE: env } = process.env
  const { PRIVATE_KEY } = Config
  const { UPLOAD_API_DID } = process.env
  const did = getServiceSigner({ UPLOAD_API_DID, PRIVATE_KEY }).did()
  const repo = 'https://github.com/web3-storage/upload-api'
  return {
    statusCode: 200,
    headers: {
      'Content-Type': `application/json`
    },
    body: JSON.stringify({ name, version, did, repo, commit, env })
  }
}

export const version = Sentry.AWSLambda.wrapHandler(versionGet)

/**
 * AWS HTTP Gateway handler for GET /
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request 
 */
export async function homeGet (request) {
  const { VERSION: version, STAGE: stage } = process.env
  const { PRIVATE_KEY } = Config
  const { UPLOAD_API_DID } = process.env
  const did = getServiceSigner({ UPLOAD_API_DID, PRIVATE_KEY }).did()
  const repo = 'https://github.com/web3-storage/upload-api'
  const env = stage === 'prod' ? '' : `(${stage})`
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    },
    body: `⁂ upload-api v${version} ${env}\n- ${repo}\n- ${did}\n`
  }
}

export const home = Sentry.AWSLambda.wrapHandler(homeGet)

/**
 * AWS HTTP Gateway handler for GET /error
 */
 export async function errorGet () {
  throw new Error('API Error')
}

export const error = Sentry.AWSLambda.wrapHandler(errorGet)
