import * as fs from 'fs'
import dotenv from 'dotenv'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { GlueClient, CreateJobCommand } from '@aws-sdk/client-glue'

import { mustGetEnv } from '../../../lib/env.js'

dotenv.config({ path: '.env.local' })

const config = {
  region: mustGetEnv('AWS_REGION'),
  roleArn: mustGetEnv('ROLE_ARN'),
  scriptsBucketName: mustGetEnv('SCRIPTS_BUCKET_NAME'),
  dynamoExportBucketName: mustGetEnv('DYNAMO_EXPORT_BUCKET_NAME'),
  exportDataPath: mustGetEnv('EXPORT_DATA_PATH'),
}

const glue = new GlueClient({ region: config.region })
const s3 = new S3Client({ region: config.region })

/**
 * Uploads a script to S3.
 *
 * @param {string} filePath - Local file path.
 * @param {string} scriptKey - S3 object key.
 */
async function uploadScript(filePath, scriptKey) {
  try {
    const fileStream = fs.createReadStream(filePath)

    const command = new PutObjectCommand({
      Bucket: config.scriptsBucketName,
      Key: scriptKey,
      Body: fileStream,
    })

    await s3.send(command)
    console.log(`✅ Uploaded ${scriptKey} to S3`)
  } catch (error) {
    console.error(`❌ Error uploading ${scriptKey}:`, error)
  }
}

/**
 * Creates an AWS Glue Job.
 *
 * @param {string} name - Glue job name.
 * @param {string} scriptKey - S3 script key.
 * @param {Record<string, string>} defaultArguments - Job arguments.
 */
async function createJob(name, scriptKey, defaultArguments) {
  try {
    const command = new CreateJobCommand({
      Name: name,
      Role: config.roleArn,
      Command: {
        Name: 'glueetl',
        PythonVersion: '3',
        ScriptLocation: `s3://${config.scriptsBucketName}/${scriptKey}`,
      },
      DefaultArguments: defaultArguments,
      GlueVersion: '5.0',
      WorkerType: 'G.1X',
      NumberOfWorkers: 10,
      Timeout: 60,
    })

    await glue.send(command)
    console.log(`✅ Glue job '${name}' created`)
  } catch (error) {
    console.error(`❌ Error creating Glue job '${name}':`, error)
  }
}

/**
 * Main function to execute script uploads and Glue job creation.
 */
async function main() {
  console.log('🚀 Starting deployment...')

  await uploadScript('./glue-jobs/dedupe-space-diff.py', 'dedupe-space-diff.py')

  // Create Glue job
  await createJob('dedupe-space-diff-table', 'dedupe-space-diff.py', {
    '--S3_INPUT_PATH': `s3://${config.dynamoExportBucketName}/${config.exportDataPath}`,
    '--S3_OUTPUT_PATH': `s3://${config.dynamoExportBucketName}/dedupe_output/`,
  })

  console.log('🎉 Deployment complete!')
}

// Execute script
try {
  await main()
} catch (e) {
  console.error(e)
}
