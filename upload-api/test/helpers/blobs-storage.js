import http from 'node:http'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { ok } from '@ucanto/server'
import { useBlobsStorage } from '../../stores/blobs.js'

/**
 * @param {import('@aws-sdk/client-s3').S3Client} s3
 * @param {string} bucketName
 */
export const useTestBlobsStorage = async (s3, bucketName) => {
  const storage = useBlobsStorage(s3, bucketName)

  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET') {
      try {
        const res = await s3.send(new GetObjectCommand({
          Bucket: bucketName,
          Key: request.url?.slice(1)
        }))
        response.writeHead(200)
        response.write(await res.Body?.transformToByteArray())
      } catch (/** @type {any} */ err) {
        console.error(err)
        response.writeHead(err.$metadata?.httpStatusCode ?? 500)
      }
    } else {
      response.writeHead(405)
    }

    response.end()
    response.destroy()
  })
  await new Promise((resolve) => server.listen(resolve))

  // @ts-ignore - this is actually what it returns on http
  const { port } = server.address()

  const createDownloadUrl = storage.createDownloadUrl.bind(storage)
  return Object.assign(storage, {
    /** @param {Uint8Array} digestBytes */
    async createDownloadUrl (digestBytes) {
      const res = await createDownloadUrl(digestBytes)
      if (!res.ok) return res
      const { pathname } = new URL(res.ok)
      return ok(`http://127.0.0.1:${port}${pathname}`)
    }
  })
}
