import * as Sentry from '@sentry/serverless'
import * as UploadAPI from '@storacha/upload-api'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

export const createServiceRouter = UploadAPI.createService

/**
 * @param {import('@ucanto/interface').Signer} servicePrincipal
 * @param {Omit<UploadAPI.UcantoServerContext, 'errorReporter'|'id'|'maxUploadSize'|'validateAuthorization'>} context
 */
export const createUcantoServer = (servicePrincipal, context) =>
  UploadAPI.createServer({
    ...context,
    id: servicePrincipal,
    errorReporter: {
      catch: (/** @type {string | Error} */ err) => {
        console.warn(err)
        Sentry.AWSLambda.captureException(err)
      },
    },
  })
