import {
  State
} from '@serverless-stack/core'
import { createRequire } from 'module'
import { S3Client } from '@aws-sdk/client-s3'

// Either seed.run deployment, or development deploy outputs-file
// https://seed.run/docs/adding-a-post-deploy-phase.html#post-deploy-phase-environment
export const stage = process.env.SEED_STAGE_NAME || State.getStage(process.cwd())

export const getApiEndpoint = () => {
  // CI/CD deployment
  if (process.env.SEED_APP_NAME) {
    return `https://${stage}.up.web3.storage`
  }

  const require = createRequire(import.meta.url)
  const sst = require('../../sst.json')
  const testEnv = require('../../.test-env.json')

  // Get Upload API endpoint
  const id = 'UploadApiStack'
  return testEnv[`${stage}-${sst.name}-${id}`].ApiEndpoint
}


export const getCloudflareBucketClient = () => new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || '',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})
