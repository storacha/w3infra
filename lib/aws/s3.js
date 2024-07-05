import { S3Client } from '@aws-sdk/client-s3'

/**
 * @typedef {{
*   region: string
*   endpoint?: string
*   credentials?: { accessKeyId: string, secretAccessKey: string }
* }} Address
*/

/** @type {Record<string, import('@aws-sdk/client-s3').S3Client>} */
const s3Clients = {}

/** @param {Address} config */
export function getS3Client (config) {
  const key = `${config.region}#${config.endpoint ?? 'default'}#${config.credentials?.accessKeyId ?? 'default'}`
  if (!s3Clients[key]) {
    s3Clients[key] = new S3Client(config)
  }
  return s3Clients[key]
}
