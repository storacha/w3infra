import {
  S3Client
} from '@aws-sdk/client-s3'

import { carBackupAndIndex } from '../carpark/backup-and-index.js'
import parseSqsEvent from '../utils/parse-sqs-event.js'

/**
 * Get EventRecord from the SQS Event triggering the handler
 *
 * @param {import('aws-lambda').SQSEvent} event
 */
export function handler (event) {
  const {
    BACKUP_ACCOUNT_ID,
    BACKUP_ACCESS_KEY_ID,
    BACKUP_SECRET_ACCESS_KEY,
    BACKUP_CAR_BUCKET_NAME,
    BACKUP_INDEX_BUCKET_NAME,
  } = getEnv()

  const record = parseSqsEvent(event)
  if (!record) {
    throw new Error('Invalid CAR file format')
  }

  const destinationBucket = new S3Client({
    region: 'auto',
    endpoint: `https://${BACKUP_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: BACKUP_ACCESS_KEY_ID,
      secretAccessKey: BACKUP_SECRET_ACCESS_KEY,
    },
  })

  const originBucket = new S3Client({ region: record.bucketRegion })
  return carBackupAndIndex({
    record,
    destinationBucket,
    originBucket,
    destinationBucketCarName: BACKUP_CAR_BUCKET_NAME,
    destinationBucketSideIndexName: BACKUP_INDEX_BUCKET_NAME,
  })
}

/**
 * Get Env validating it is set.
 */
function getEnv() {
  const {
    BACKUP_ACCOUNT_ID,
    BACKUP_ACCESS_KEY_ID,
    BACKUP_SECRET_ACCESS_KEY,
    BACKUP_CAR_BUCKET_NAME,
    BACKUP_INDEX_BUCKET_NAME,
  } = process.env

  if (
    !BACKUP_ACCOUNT_ID ||
    !BACKUP_ACCESS_KEY_ID ||
    !BACKUP_SECRET_ACCESS_KEY ||
    !BACKUP_CAR_BUCKET_NAME ||
    !BACKUP_INDEX_BUCKET_NAME
  ) {
    throw new Error('Environment setup not completed')
  }

  return {
    BACKUP_ACCOUNT_ID,
    BACKUP_ACCESS_KEY_ID,
    BACKUP_SECRET_ACCESS_KEY,
    BACKUP_CAR_BUCKET_NAME,
    BACKUP_INDEX_BUCKET_NAME,
  }
}
