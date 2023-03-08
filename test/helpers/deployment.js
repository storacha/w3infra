import {
  State
} from '@serverless-stack/core'
import { createRequire } from 'module'
import { S3Client } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

// Either seed.run deployment, or development deploy outputs-file
// https://seed.run/docs/adding-a-post-deploy-phase.html#post-deploy-phase-environment
export const stage = process.env.SEED_STAGE_NAME || State.getStage(process.cwd())

export const getStackName = () => {
  const require = createRequire(import.meta.url)
  const sst = require('../../sst.json')
  return `${stage}-${sst.name}`
}

export const getCloudflareBucketClient = () => new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT || '',
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
})

export const getAwsBucketClient = () => new S3Client({
  region: getAwsRegion()
})

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

export const getSatnavBucketInfo = () => {
  // CI/CD deployment
  if (process.env.SEED_APP_NAME) {
    return {
      Bucket: `satnav-${stage}-0`,
      Region: 'us-east-2'
    }
  }

  const require = createRequire(import.meta.url)
  const sst = require('../../sst.json')
  const testEnv = require('../../.test-env.json')

  // Get Satnav metadata
  const id = 'SatnavStack'
  return {
    Bucket: testEnv[`${stage}-${sst.name}-${id}`].BucketName,
    Region: testEnv[`${stage}-${sst.name}-${id}`].Region,
  }
}

export const getCarparkBucketInfo = () => {
  // CI/CD deployment
  if (process.env.SEED_APP_NAME) {
    return {
      Bucket: `carpark-${stage}-0`,
      Region: 'us-east-2'
    }
  }

  const require = createRequire(import.meta.url)
  const sst = require('../../sst.json')
  const testEnv = require('../../.test-env.json')

  // Get Carpark metadata
  const id = 'CarparkStack'
  return {
    Bucket: testEnv[`${stage}-${sst.name}-${id}`].BucketName,
    Region: testEnv[`${stage}-${sst.name}-${id}`].Region,
  }
}

const getAwsRegion = () => {
  // CI/CD deployment
  if (process.env.SEED_APP_NAME) {
    return 'us-east-2'
  }

  return 'us-west-2'
}

/**
 * @param {string} tableName 
 */
export const getDynamoDb = (tableName) => {
  const region = getAwsRegion()
  const endpoint = `https://dynamodb.${region}.amazonaws.com`

  return {
    client: new DynamoDBClient({
      region,
      endpoint
    }),
    tableName: `${getStackName()}-${tableName}`,
    region,
    endpoint
  }
}
