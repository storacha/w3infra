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

test.before(async (t) => {
  Object.assign(t.context, {
    dynamo: await createDynamodDb(),
    s3: (await createS3()).client,
  })
})

testDelegationsStorageVariant(
  async (/** @type {any} */ t) => {
    const { dynamo, s3 } = t.context
    const bucketName = await createBucket(s3)
    
    return useDelegationsTable(
      dynamo,
      await createTable(dynamo, delegationTableProps),
      useDelegationsStore(s3, bucketName)
    )
  },
  test
)