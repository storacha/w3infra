import { GenericContainer as Container } from 'testcontainers'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { customAlphabet } from 'nanoid'

const id = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10)

/** @param {{ region?: string }} [opts] */
export const createS3 = async opts => {
  console.log('Creating local S3...')
  const port = 9000
  const region = opts?.region ?? 'us-west-2'
  const container = await new Container('quay.io/minio/minio')
    .withCommand(['server', '/data'])
    .withExposedPorts(port)
    .start()
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(port)}`
  const clientOpts = {
    endpoint,
    forcePathStyle: true,
    region,
    credentials: {
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
    }
  }
  return { client: new S3Client(clientOpts), endpoint }
}

/** @param {S3Client} s3 */
export async function createBucket(s3) {
  const name = id()
  console.log(`Creating S3 bucket "${name}"...`)
  await s3.send(new CreateBucketCommand({ Bucket: name }))
  return name
}
