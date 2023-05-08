import * as Sentry from '@sentry/serverless'
import * as UploadAPI from '@web3-storage/upload-api'
import * as Legacy from '@ucanto/transport/legacy'

Sentry.AWSLambda.init({
  environment: process.env.SST_STAGE,
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
})

export const createServiceRouter = UploadAPI.createService

export const MAX_S3_PUT_SIZE = 5_000_000_000

/**
 * @param {import('@ucanto/interface').Signer} servicePrincipal
 * @param {Omit<UploadAPI.UcantoServerContext, 'errorReporter'|'id'|'maxUploadSize'>} context
 */
export const createUcantoServer = (servicePrincipal, context) =>
  UploadAPI.createServer({
    ...context,
    // provide legacy tranpsort for backwards compatibility with old clients
    codec: Legacy.inbound,
    id: servicePrincipal,
    maxUploadSize: MAX_S3_PUT_SIZE,
    errorReporter: {
      catch: (/** @type {string | Error} */ err) => {
        console.warn(err)
        Sentry.AWSLambda.captureException(err)
      },
    },
  })
