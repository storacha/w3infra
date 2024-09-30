/**
 * Temporary stack for the old Pinning Service API (PSA) that maps root CIDs
 * to CAR files the complete DAGs are stored in.
 */
import { Function } from 'sst/constructs'

/** @param {import('sst/constructs').StackContext} context */
export function PSAStack ({ stack }) {
  stack.setDefaultFunctionProps({
    runtime: 'nodejs20.x',
    architecture: 'arm_64',
    environment: {
      R2_ENDPOINT: process.env.R2_ENDPOINT ?? '',
      R2_REGION: process.env.R2_REGION ?? '',
      R2_CARPARK_BUCKET_NAME: process.env.R2_CARPARK_BUCKET_NAME ?? '',
      R2_DUDEWHERE_BUCKET_NAME: process.env.R2_DUDEWHERE_BUCKET_NAME ?? '',
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? '',
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? ''
    }
  })

  const hashFunction = new Function(stack, 'hash', {
    handler: 'psa/functions/hash.handler',
    url: { cors: true, authorizer: 'none' },
    memorySize: '4 GB',
    timeout: '15 minutes'
  })

  hashFunction.attachPermissions(['s3:HeadObject', 's3:GetObject'])

  const downloadFunction = new Function(stack, 'download', {
    handler: 'psa/functions/download.handler',
    url: { cors: true, authorizer: 'none' }
  })

  downloadFunction.attachPermissions(['s3:HeadObject', 's3:GetObject'])

  stack.addOutputs({
    hashFunctionURL: hashFunction.url,
    downloadFunctionURL: downloadFunction.url,
  })
}
