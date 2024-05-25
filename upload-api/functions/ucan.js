import { Config } from 'sst/node/config'
import { Kinesis } from '@aws-sdk/client-kinesis'
import * as Sentry from '@sentry/serverless'

import { createInvocationStore } from '../buckets/invocation-store.js'
import { createTaskStore } from '../buckets/task-store.js'
import { createWorkflowStore } from '../buckets/workflow-store.js'
import { processUcanLogRequest } from '../ucan-invocation.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

const kinesisClient = new Kinesis({})
const AWS_REGION = process.env.AWS_REGION || 'us-west-2'

/**
 * AWS HTTP Gateway handler for POST / with ucan invocation router.
 *
 * We provide responses in Payload format v2.0
 * see: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html#http-api-develop-integrations-lambda.proxy-format
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
async function handlerFn(request) {
  const {
    INVOCATION_BUCKET_NAME: invocationBucketName = '',
    TASK_BUCKET_NAME: taskBucketName = '',
    WORKFLOW_BUCKET_NAME: workflowBucketName = '',
    UCAN_LOG_STREAM_NAME: streamName = '',
  } = process.env

  const { UCAN_INVOCATION_POST_BASIC_AUTH } = Config

  const invocationBucket = createInvocationStore(
    AWS_REGION,
    invocationBucketName
  )
  // const taskBucket = createTaskStore(AWS_REGION, taskBucketName)
  const workflowBucket = createWorkflowStore(AWS_REGION, workflowBucketName)

  try {
    await processUcanLogRequest(request, {
      invocationBucket,
      workflowBucket,
      streamName,
      basicAuth: UCAN_INVOCATION_POST_BASIC_AUTH,
      kinesisClient,
    })
  } catch (/** @type {any} */ error) {
    return {
      statusCode: error.status ?? 500,
      body: Buffer.from(error.message).toString('base64'),
      isBase64Encoded: true,
    }
  }

  return {
    statusCode: 200,
  }
}

export const handler = Sentry.AWSLambda.wrapHandler(handlerFn)
