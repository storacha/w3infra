import { test } from './helpers/context.js'

import {
  parseQueryStringParameters,
  parseKeyQueryStringParameters,
  MAX_EXPIRES_IN,
  MIN_EXPIRES_IN,
  DEFAULT_EXPIRES_IN
} from '../utils.js'

test('parses valid expires', t => {
  const queryParams = {
    expires: '900'
  }
  const param = parseQueryStringParameters(queryParams)
  t.is(param.expiresIn, parseInt(queryParams.expires))
})

test('parses bucket name with key', t => {
  const queryParams = {
    bucket: 'dagcargo'
  }
  const param = parseKeyQueryStringParameters(queryParams)
  t.is(param.bucketName, queryParams.bucket)
})

test('fails to parse bucket name not accepted', t => {
  const queryParams = {
    bucket: 'dagcargo-not-this'
  }
  t.throws(() => parseKeyQueryStringParameters(queryParams))
})

test('parses valid expires query parameter', t => {
  const queryParams = {
    expires: '900'
  }
  const param = parseQueryStringParameters(queryParams)
  t.is(param.expiresIn, parseInt(queryParams.expires))
})

test('defaults expires when there is no query parameter', t => {
  const queryParams = {
    nosearch: '900'
  }
  const param = parseQueryStringParameters(queryParams)
  t.is(param.expiresIn, DEFAULT_EXPIRES_IN)
})

test('fails to parse expires query parameter when not acceptable value', t => {
  const queryParamsBigger = {
    expires: `${MAX_EXPIRES_IN + 1}`
  }
  t.throws(() => parseQueryStringParameters(queryParamsBigger))

  const queryParamsSmaller = {
    expires: `${MIN_EXPIRES_IN - 1}`
  }
  t.throws(() => parseQueryStringParameters(queryParamsSmaller))
})
