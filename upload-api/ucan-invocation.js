import * as CAR from '@ucanto/transport/car'
import { AgentMessage } from '@web3-storage/upload-api'

import {
  BadBodyError,
  BadContentTypeError,
  NoTokenError,
  ExpectedBasicStringError,
  NoValidTokenError,
} from './errors.js'

export const CONTENT_TYPE = CAR.contentType

/**
 * @typedef {import('./types').UcanLogCtx} UcanLogCtx
 * @typedef {import('./types').WorkflowCtx} WorkflowCtx
 * @typedef {import('./types').ReceiptBlockCtx} ReceiptBlockCtx
 * @typedef {import('./types').Workflow} Workflow
 * @typedef {import('./types').ReceiptBlock} ReceiptBlock
 */

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 * @param {UcanLogCtx} ctx
 */
export async function processUcanLogRequest(request, ctx) {
  const token = getTokenFromRequest(request)
  if (token !== ctx.basicAuth) {
    throw new NoValidTokenError('invalid Authorization credentials provided')
  }

  if (!request.body) {
    throw new BadBodyError('service requests are required to have body')
  }
  const bytes = Buffer.from(request.body, 'base64')

  const contentType = request.headers['content-type'] || ''
  if (contentType === CONTENT_TYPE) {
    const request = {
      body: bytes,
      headers: {
        'content-type': contentType,
      },
    }
    const message = await CAR.request.decode(request)

    const result = await ctx.agentStore.messages.write({
      source: request,
      data: message,
      index: AgentMessage.index(message)
    })

    if (result.error) {
      throw result.error
    }

    return result.ok
  }

  throw new BadContentTypeError()
}

/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request
 */
function getTokenFromRequest(request) {
  const authHeader = request.headers.authorization || ''
  if (!authHeader) {
    throw new NoTokenError('no Authorization header provided')
  }

  const token = parseAuthorizationHeader(authHeader)
  return token
}

/**
 * @param {string} header
 */
function parseAuthorizationHeader(header) {
  if (!header.toLowerCase().startsWith('basic ')) {
    throw new ExpectedBasicStringError('no basic Authorization header provided')
  }

  return header.slice(6)
}

