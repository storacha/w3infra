import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import { Writable } from 'node:stream'
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { mustGetEnv } from '../../../lib/env.js'

dotenv.config({ path: '.env.local' })

const region = mustGetEnv('AWS_REGION')
const s3 = new S3Client({ region })

/**
 * @param {string} bucketName
 * @param {string} folderPath
 * @returns {Promise<(string)[]>}
 */
async function listFiles(bucketName, folderPath) {
  const command = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: folderPath,
  })
  const response = await s3.send(command)
  if (response.Contents) {
    return /** @type {string[]} */ (response.Contents.map((item) => item.Key))
  }
  return []
}

/**
 * @param {string} bucketName
 * @param {string} file
 * @param {string} outputDir
 */
async function downloadFile(bucketName, file, outputDir) {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: file,
  })
  const { Body } = await s3.send(command)
  if (!Body) {
    console.error(`Error downloading ${file}`)
    return
  }
  const fileName = path.basename(file)
  const filePath = path.join(outputDir, fileName)

  const writeStream = Writable.toWeb(fs.createWriteStream(filePath))

  await Body.transformToWebStream().pipeTo(writeStream)
  console.log(`Downloaded: ${fileName}`)
}

export async function main() {
  const s3BucketPath = process.argv[2].split('/')
  const outputPath = process.argv[3]

  const bucketName = /** @type {string} */ (s3BucketPath.shift())
  const folderPath = s3BucketPath.join('/')

  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true })
  }

  const files = await listFiles(bucketName, folderPath)
  if (files.length === 0) {
    console.log('No files found in the specified folder.')
    return
  }

  for (const file of files) {
    await downloadFile(bucketName, file, outputPath)
  }
  console.log('All files downloaded successfully.')
}

try {
  await main()
} catch (e) {
  console.error(e)
}
