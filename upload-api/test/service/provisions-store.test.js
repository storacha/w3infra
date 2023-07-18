import { test } from '../helpers/context.js'
import { executionContextToUcantoTestServerContext } from "../helpers/ucan.js"
import { assertsFromExecutionContext } from '../helpers/assert.js'
import { provisionsStorageTests } from '@web3-storage/upload-api/test'
import {
  createS3,
  createDynamodDb,
} from '../helpers/resources.js'

test.before(async (t) => {
  Object.assign(t.context, {
    dynamo: await createDynamodDb(),
    s3: (await createS3()).client,
  })
})

for (const [title, unit] of Object.entries(provisionsStorageTests)) {
  test(title, async (t) => {
    await unit(
      assertsFromExecutionContext(t),
      await executionContextToUcantoTestServerContext(t)
    )
  })
}
