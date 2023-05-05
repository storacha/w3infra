/* eslint-disable no-loop-func */
import { Upload } from '@web3-storage/upload-api/test'
import { test } from '../helpers/context.js'
import { ed25519 } from '@ucanto/principal'
import {
  createS3,
  createBucket,
  createDynamodDb,
  createTable,
} from '../helpers/resources.js'
import { storeTableProps, uploadTableProps } from '../../tables/index.js'
import { useCarStore } from '../../buckets/car-store.js'
import { useDudewhereStore } from '../../buckets/dudewhere-store.js'
import { useStoreTable } from '../../tables/store.js'
import { useUploadTable } from '../../tables/upload.js'
import { create as createAccessVerifier } from '../access-verifier.js'

test.before(async (t) => {
  Object.assign(t.context, {
    dynamo: await createDynamodDb(),
    s3: (await createS3()).client,
  })
})

for (const [title, unit] of Object.entries(Upload.test)) {
  test(title, async (t) => {
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

    const signer = await ed25519.generate()
    const id = signer.withDID('did:web:test.web3.storage')

    const access = createAccessVerifier({ id })

    await unit(
      {
        ok: (actual, message) => t.truthy(actual, message),
        equal: (actual, expect, message) =>
          t.is(actual, expect, message ? String(message) : undefined),
        deepEqual: (actual, expect, message) =>
          t.deepEqual(actual, expect, message ? String(message) : undefined),
      },
      {
        id,
        errorReporter: {
          catch(error) {
            t.fail(error.message)
          },
        },
        maxUploadSize: 5_000_000_000,
        storeTable,
        testStoreTable: storeTable,
        uploadTable,
        // @ts-expect-error - will be removed
        testUploadTable: uploadTable,
        carStoreBucket,
        dudewhereBucket,
        access,
        testSpaceRegistry: access,
      }
    )
  })
}
