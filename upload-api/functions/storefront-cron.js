import * as Sentry from '@sentry/serverless'
import { handleCronTick } from '../../filecoin/functions/handle-cron-tick.js'
import { wrapLambdaHandler } from '../otel.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

export const handler = Sentry.AWSLambda.wrapHandler(
  wrapLambdaHandler('storefront-cron', handleCronTick)
)
