/* eslint-disable no-loop-func */
import { test } from '../helpers/context.js'
import { testDelegationsStorageVariant } from '@web3-storage/upload-api/test'
import {
  createS3,
  createBucket,
  createDynamodDb,
  createTable,
} from '../helpers/resources.js'
import { delegationTableProps } from '../../tables/index.js'
import { useDelegationsTable } from '../../tables/delegations.js'
import { useDelegationsStore } from '../../buckets/delegations-store.js'
import { useInvocationStore } from '../../buckets/invocation-store.js'
import { useWorkflowStore } from '../../buckets/workflow-store.js'

test.before(async (t) => {
  Object.assign(t.context, {
    dynamo: await createDynamodDb(),
    s3: (await createS3()).client,
  })
})

testDelegationsStorageVariant(
  async (/** @type {any} */ t) => {
    const { dynamo, s3 } = t.context
    const delegationsBucketName = await createBucket(s3)
    const invocationsBucketName = await createBucket(s3)
    const workflowBucketName = await createBucket(s3)


    return useDelegationsTable(
      dynamo,
      await createTable(dynamo, delegationTableProps),
      {
        bucket: useDelegationsStore (s3, delegationsBucketName),
        invocationBucket: useInvocationStore (s3, invocationsBucketName),
        workflowBucket: useWorkflowStore (s3, workflowBucketName)
      }
    )
  },
  test
)