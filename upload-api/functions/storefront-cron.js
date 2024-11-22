import * as Sentry from '@sentry/serverless'
import { handleCronTick } from '../../filecoin/functions/handle-cron-tick.js'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

export const handler = Sentry.AWSLambda.wrapHandler(handleCronTick)
