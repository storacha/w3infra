import anyTest from 'ava'
import { uploadTableProps } from '../tables/index.js'
import { createDynamodDb, createTable } from './helpers/resources.js'
import { useUploadTable } from '../tables/upload.js'
import { randomCID, randomDID } from './helpers/random.js'
import * as Monitor from '../monitor.js'

/**
 * @typedef {{ tableName: string, uploadTable: import('@storacha/upload-api').UploadTable }} Context
 * @typedef {import('ava').TestFn<import('./helpers/context.js').DynamoContext & Context>} TestFn
 */
const test = /** @type {TestFn} */ (anyTest)

test.before(async t => {
  const dynamo = await createDynamodDb()
  const tableName = await createTable(dynamo, uploadTableProps)
  const uploadTable = useUploadTable(dynamo, tableName)
  Object.assign(t.context, { dynamo, uploadTable, tableName })
})

test('should retrieve a random sample of upload root CIDs', async t => {
  const { dynamo, tableName, uploadTable } = t.context

  const uploads = []
  for (let i = 0; i < 10; i++) {
    const [space, root, issuer, invocation] =
      await Promise.all([randomDID(), randomCID(), randomDID(), randomCID()])
    const upload = { space, root, issuer, invocation }
    const res = await uploadTable.upsert(upload)
    t.truthy(res.ok)
    uploads.push(upload)
  }

  const samples = []
  for await (const s of Monitor.sampleUploads(dynamo, tableName, { size: 3 })) {
    samples.push(s)
  }

  t.is(samples.length, 3)
  for (const sample of samples) {
    t.true(uploads.some(u => u.root.toString() === sample.root.toString()))
  }
})
