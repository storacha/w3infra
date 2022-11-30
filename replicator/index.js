import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'

/**
 * @typedef {import('@aws-sdk/client-s3').S3Client} S3Client
 */

/**
 * Replicate event target into destination bucket and write a side index for it.
 *
 * @param {object} props
 * @param {import('./utils/parse-sqs-event').EventRecord} props.record
 * @param {S3Client} props.destinationBucket
 * @param {S3Client} props.originBucket
 * @param {string} props.destinationBucketName
 */
 export const replicate = async ({
  record,
  destinationBucket,
  destinationBucketName,
  originBucket,
}) => {
  const key = record.key

  // Verify if event file already exist in destination bucket
  try {
    await destinationBucket.send(
      new HeadObjectCommand({
        Bucket: destinationBucketName,
        Key: key,
      })
    )
  } catch {
    // Not in destinationBucket, so read from origin bucket and write to destination bucket
    const getCmd = new GetObjectCommand({
      Bucket: record.bucketName,
      Key: key,
    })

    // TODO: md5
    const res = await originBucket.send(getCmd)
    if (!res.Body) {
      throw new Error('invalid CAR file retrieved')
    }

    // @ts-expect-error aws types body does not include pipe...
    await writeCarToBucket(key, res.Body, destinationBucketName, destinationBucket, { contentLength: res.ContentLength })
  }
}

/**
 * @param {string} key
 * @param {import('stream').Readable} body
 * @param {string} bucketName
 * @param {S3Client} client
 * @param {object} [options]
 * @param {number} [options.contentLength]
 */
async function writeCarToBucket(key, body, bucketName, client, options = {}) {
  try {
    const putCmd = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      // TODO: md5
      ContentLength: options.contentLength,
    })

    await client.send(putCmd)
  } catch (error) {
    throw new Error('error saving car to R2:' + error)
  }
}
