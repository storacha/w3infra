import {
  Api,
} from 'sst/constructs'

import { getCustomDomain, getEnv, setupSentry } from './config.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export function RoundaboutStack({ stack, app }) {
  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  const { INDEXING_SERVICE_URL } = getEnv()

  // Setup API
  const customDomain = getCustomDomain(stack.stage, process.env.ROUNDABOUT_HOSTED_ZONE)

  const api = new Api(stack, 'roundabout-http-gateway', {
    customDomain,
    defaults: {
      function: {
        environment: {
          INDEXING_SERVICE_URL,
        }
      }
    },
    routes: {
      'GET /{cid}':       'roundabout/functions/redirect.handler',
      'HEAD /{cid}':      'roundabout/functions/redirect.handler',
      'GET /key/{key}':   'roundabout/functions/redirect.keyHandler',
      'HEAD /key/{key}':   'roundabout/functions/redirect.keyHandler',
    },
    accessLog: {
      format:'{"requestTime":"$context.requestTime","requestId":"$context.requestId","httpMethod":"$context.httpMethod","path":"$context.path","routeKey":"$context.routeKey","status":$context.status,"responseLatency":$context.responseLatency,"integrationRequestId":"$context.integration.requestId","integrationStatus":"$context.integration.status","integrationLatency":"$context.integration.latency","integrationServiceStatus":"$context.integration.integrationStatus","ip":"$context.identity.sourceIp","userAgent":"$context.identity.userAgent"}'
    }
  })

  stack.addOutputs({
    ApiEndpoint: api.url,
    CustomDomain:  customDomain ? `https://${customDomain.domainName}` : 'Set HOSTED_ZONE in env to deploy to a custom domain'
  })

  return {
    roundaboutApiUrl: api.url
  }
}
