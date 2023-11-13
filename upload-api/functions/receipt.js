import * as Sentry from '@sentry/serverless'
import { parseLink } from '@ucanto/server'

import { createInvocationStore } from '../buckets/invocation-store.js'
import { mustGetEnv } from './utils.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

/**
 * AWS HTTP Gateway handler for GET /receipt.
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} event
 */
export async function receiptGet (event) {
  const {
    invocationBucketName,
    workflowBucketName,
  } = getLambdaEnv()
  const invocationBucket = createInvocationStore(
    AWS_REGION,
    invocationBucketName
  )

  if (!event.pathParameters?.taskCid) {
    return {
      statusCode: 400,
      body: Buffer.from(`no task cid received`).toString('base64'),
    }
  }
  const taskCid = parseLink(event.pathParameters.taskCid)

  const workflowLinkWithReceipt = await invocationBucket.getWorkflowLink(taskCid.toString())
  const url = `https://${workflowBucketName}.s3.${AWS_REGION}.amazonaws.com/${workflowLinkWithReceipt}/${workflowLinkWithReceipt}`

  // redirect to bucket
  return {
    statusCode: 302,
    headers: {
      Location: url
    }
  }
}

function getLambdaEnv () {
  return {
    invocationBucketName: mustGetEnv('INVOCATION_BUCKET_NAME'),
    workflowBucketName: mustGetEnv('WORKFLOW_BUCKET_NAME'),
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(receiptGet)
