import anyTest from 'ava'
import { Signer } from '@ucanto/principal/ed25519'
import { connect, createServer } from '@web3-storage/upload-api'
import { DebugEmail } from '@web3-storage/upload-api/test'
import {
  createBucket,
  createTable,
} from '../helpers/resources.js'
import { storeTableProps, uploadTableProps, consumerTableProps, delegationTableProps, subscriptionTableProps } from '../../tables/index.js'
import { useCarStore } from '../../buckets/car-store.js'
import { useDudewhereStore } from '../../buckets/dudewhere-store.js'
import { useStoreTable } from '../../tables/store.js'
import { useUploadTable } from '../../tables/upload.js'
import { create as createAccessVerifier } from '../access-verifier.js'
import { useProvisionStore } from '../../stores/provisions.js'
import { useConsumerTable } from '../../tables/consumer.js'
import { useSubscriptionTable } from '../../tables/subscription.js'
import { useDelegationsTable } from '../../tables/delegations.js'
import { useDelegationsStore } from '../../buckets/delegations-store.js'
import { useInvocationStore } from '../../buckets/invocation-store.js'
import { useWorkflowStore } from '../../buckets/workflow-store.js'

/**
 * @typedef {object} DynamoContext
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClient} dynamo
 * @typedef {object} S3Context
 * @property {import('@aws-sdk/client-s3').S3Client} s3
 * @typedef {import('@ucanto/principal/ed25519').Signer.Signer<`did:web:${string}`, import('@ucanto/principal/ed25519').SigAlg>} Signer
 * @typedef {object} ServiceContext
 * @property {Signer} service
 * @typedef {object} MetricsContext
 * @property {import('../../tables/metrics').MetricsTable} metricsTable
 * @property {string} tableName
 *
 * @typedef {import("ava").TestFn<DynamoContext & S3Context & ServiceContext>} Test
 * @typedef {import("ava").TestFn<DynamoContext>} TestDynamo
 * @typedef {import("ava").TestFn<S3Context>} TestS3
 * @typedef {import("ava").TestFn<DynamoContext & MetricsContext>} TestMetrics
 * @typedef {import("ava").TestFn<ServiceContext>} TestService
 */

// eslint-disable-next-line unicorn/prefer-export-from
export const s3 = /** @type {TestS3} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const dynamo = /** @type {TestDynamo} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const test = /** @type {Test} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const testMetrics = /** @type {TestMetrics} */ (anyTest)

// eslint-disable-next-line unicorn/prefer-export-from
export const service = /** @type {TestService} */ (anyTest)

/**
 * 
 * @param {import('ava').ExecutionContext} t 
 * @returns {Promise<import('@web3-storage/upload-api').UcantoServerTestContext>}
 */
export async function executionContextToUcantoTestServerContext (t) {
  const service = Signer.parse('MgCYWjE6vp0cn3amPan2xPO+f6EZ3I+KwuN1w2vx57vpJ9O0Bn4ci4jn8itwc121ujm7lDHkCW24LuKfZwIdmsifVysY=').withDID(
    'did:web:test.web3.storage'
  )
  const { dynamo, s3 } = t.context
  const bucketName = await createBucket(s3)

  const storeTable = useStoreTable(
    dynamo,
    await createTable(dynamo, storeTableProps)
  )

  const uploadTable = useUploadTable(
    dynamo,
    await createTable(dynamo, uploadTableProps)
  )
  const carStoreBucket = useCarStore(s3, bucketName)

  const dudewhereBucket = useDudewhereStore(s3, bucketName)

  const signer = await Signer.generate()
  const id = signer.withDID('did:web:test.web3.storage')

  const access = createAccessVerifier({ id })
  const delegationsBucketName = await createBucket(s3)
  const invocationsBucketName = await createBucket(s3)
  const workflowBucketName = await createBucket(s3)


  const delegationsStorage = useDelegationsTable(
    dynamo,
    await createTable(dynamo, delegationTableProps),
    {
      bucket: useDelegationsStore(s3, delegationsBucketName),
      invocationBucket: useInvocationStore(s3, invocationsBucketName),
      workflowBucket: useWorkflowStore(s3, workflowBucketName)
    }
  )

  const subscriptionTable = useSubscriptionTable(
    dynamo,
    await createTable(dynamo, subscriptionTableProps)
  )
  const consumerTable = useConsumerTable(
    dynamo,
    await createTable(dynamo, consumerTableProps)
  )
  const provisionsStorage = useProvisionStore(
    subscriptionTable,
    consumerTable,
    [service.did()]
  )
  const email = new DebugEmail()
  
  /** @type {import('@web3-storage/upload-api').UcantoServerContext} */
  const serviceContext = {
    id,
    signer: id,
    email,
    url: new URL('http://example.com'),
    provisionsStorage,
    delegationsStorage,
    errorReporter: {
      catch (error) {
        t.fail(error.message)
      },
    },
    maxUploadSize: 5_000_000_000,
    storeTable,
    uploadTable,
    carStoreBucket,
    dudewhereBucket,
    access,
  }
  const connection = connect({
    id: serviceContext.id,
    channel: createServer(serviceContext)
  })


  return {
    ...serviceContext,
    mail: email,
    service: id,
    connection,
    testStoreTable: storeTable,
    testSpaceRegistry: access,
    fetch
  }
}