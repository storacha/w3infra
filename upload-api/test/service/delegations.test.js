import { executionContextToUcantoTestServerContext, test } from '../helpers/context.js'
import { assertsFromExecutionContext } from '../helpers/assert.js'
import { delegationsStorageTests } from '@web3-storage/upload-api/test'
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

for (const [title, unit] of Object.entries(delegationsStorageTests)) {
  test(title, async (t) => {
    // skip "can retrieve delegations by audience" because it currently relies on the ucan invocation 
    // router's out-of-band storage of the invocation where the delegations were originally created, which
    // does not happen in these tests. 
    // TODO: figure out how to get that in the mix here or write an integration test for this somehow
    if (title === 'can retrieve delegations by audience') {
      console.log(`skipping ${title}`)
    } else {
      await unit(
        assertsFromExecutionContext(t),
        await executionContextToUcantoTestServerContext(t)
      )
    }
  })
}
