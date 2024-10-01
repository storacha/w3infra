/**
 * Temporary stack for the old Pinning Service API (PSA) that maps root CIDs
 * to CAR files the complete DAGs are stored in.
 */
import { Function } from 'sst/constructs'
import { Bucket } from 'aws-cdk-lib/aws-s3'

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
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? '',
      S3_DOTSTORAGE_0_BUCKET_REGION: process.env.S3_DOTSTORAGE_0_BUCKET_REGION ?? '',
      S3_DOTSTORAGE_0_BUCKET_NAME: process.env.S3_DOTSTORAGE_0_BUCKET_NAME ?? '',
      S3_DOTSTORAGE_1_BUCKET_REGION: process.env.S3_DOTSTORAGE_1_BUCKET_REGION ?? '',
      S3_DOTSTORAGE_1_BUCKET_NAME: process.env.S3_DOTSTORAGE_1_BUCKET_NAME ?? '',
      S3_PICKUP_BUCKET_REGION: process.env.S3_PICKUP_BUCKET_REGION ?? '',
      S3_PICKUP_BUCKET_NAME: process.env.S3_PICKUP_BUCKET_NAME ?? '',
    }
  })

  const buckets = []
  if (process.env.S3_DOTSTORAGE_0_BUCKET_ARN) {
    buckets.push(Bucket.fromBucketArn(stack, 'dotstorage-0', process.env.S3_DOTSTORAGE_0_BUCKET_ARN))
  }
  if (process.env.S3_DOTSTORAGE_1_BUCKET_ARN) {
    buckets.push(Bucket.fromBucketArn(stack, 'dotstorage-1', process.env.S3_DOTSTORAGE_1_BUCKET_ARN))
  }
  if (process.env.S3_PICKUP_BUCKET_ARN) {
    buckets.push(Bucket.fromBucketArn(stack, 'pickup', process.env.S3_PICKUP_BUCKET_ARN))
  }

  const hashFunction = new Function(stack, 'hash', {
    handler: 'psa/functions/hash.handler',
    url: { cors: true, authorizer: 'none' },
    memorySize: '4 GB',
    timeout: '15 minutes',
    permissions: buckets
  })

  const downloadFunction = new Function(stack, 'download', {
    handler: 'psa/functions/download.handler',
    url: { cors: true, authorizer: 'none' },
    permissions: buckets
  })

  stack.addOutputs({
    hashFunctionURL: hashFunction.url,
    downloadFunctionURL: downloadFunction.url,
  })
}
