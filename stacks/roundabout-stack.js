import {
  Api,
} from '@serverless-stack/resources'

import { getCustomDomain, setupSentry } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function RoundaboutStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'roundabout'
  })

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Setup API
  const customDomain = getCustomDomain(stack.stage, process.env.ROUNDABOUT_HOSTED_ZONE)

  const api = new Api(stack, 'roundabout-http-gateway', {
    customDomain,
    defaults: {
      function: {
        environment: {
          BUCKET_ENDPOINT: process.env.R2_ENDPOINT ?? '',
          BUCKET_REGION: process.env.R2_REGION ?? '',
          BUCKET_NAME: process.env.R2_CARPARK_BUCKET_NAME ?? '',
          BUCKET_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? '',
          BUCKET_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? '',
        }
      }
    },
    routes: {
      'GET /{cid}':       'functions/redirect.handler',
      'HEAD /{cid}':      'functions/redirect.handler',
    },
    accessLog: {
      format:'{"requestTime":"$context.requestTime","requestId":"$context.requestId","httpMethod":"$context.httpMethod","path":"$context.path","routeKey":"$context.routeKey","status":$context.status,"responseLatency":$context.responseLatency,"integrationRequestId":"$context.integration.requestId","integrationStatus":"$context.integration.status","integrationLatency":"$context.integration.latency","integrationServiceStatus":"$context.integration.integrationStatus","ip":"$context.identity.sourceIp","userAgent":"$context.identity.userAgent"}'
    }
  })

  stack.addOutputs({
    ApiEndpoint: api.url,
    CustomDomain:  customDomain ? `https://${customDomain.domainName}` : 'Set HOSTED_ZONE in env to deploy to a custom domain'
  })
}
