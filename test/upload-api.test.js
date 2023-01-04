import { fetch } from '@web-std/fetch'
import { createRequire } from 'module'
import git from 'git-rev-sync'

import { test } from './helpers/context.js'
import { stage } from './helpers/deployment.js'

test('GET /', async t => {
  const apiEndpoint = getApiEndpoint()
  const response = await fetch(apiEndpoint)
  t.is(response.status, 200)
})

test('GET /version', async t => {
  const apiEndpoint = getApiEndpoint()

  const response = await fetch(`${apiEndpoint}/version`)
  t.is(response.status, 200)

  const body = await response.json()
  t.is(body.env, stage)
  t.is(body.commit, git.long('.'))
})

const getApiEndpoint = () => {
  // CI/CD deployment
  if (process.env.SEED_APP_NAME) {
    return `https://${stage}.up.web3.storage`
  }

  const require = createRequire(import.meta.url)
  const sst = require('../sst.json')
  const testEnv = require('../.test-env.json')

  // Get Upload API endpoint
  const id = 'UploadApiStack'
  return testEnv[`${stage}-${sst.name}-${id}`].ApiEndpoint
}