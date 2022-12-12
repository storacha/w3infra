import { test } from './helpers/context.js'

import { notifyBus } from '../event-bus/source.js'

import {
  s3PutInvalidRecords as fixtureS3PutInvalidRecords,
  s3PutValidRecords as fixtureS3PutValidRecords
} from './fixtures.js'

const eventBusName = 'event-bus-arn'

test('notifies event bus when a CAR file is added to the ucan store bucket', async t => {
  const bus = {
    putEvents: (/** @type {any} */ data) => {
      t.is(data.Entries.length, fixtureS3PutValidRecords.length)
      for (let i = 0; i < data.Entries.length; i++) {
        const entry = data.Entries[i]

        t.is(entry.EventBusName, eventBusName)
        t.is(entry.Source, 'ucan_store_bucket')
        t.is(entry.DetailType, 'ucan_car_added')

        const entryDetail = JSON.parse(entry.Detail)
        t.is(entryDetail.key, fixtureS3PutValidRecords[i].s3.object.key)
        t.is(entryDetail.region, fixtureS3PutValidRecords[i].awsRegion)
        t.is(entryDetail.bucketName, fixtureS3PutValidRecords[i].s3.bucket.name)
      }
      return {
        promise: () => Promise.resolve(data)
      }
    }
  }

  const response = await notifyBus({
      // @ts-expect-error incomplete S3 event metadata
      Records: fixtureS3PutValidRecords
    },
    bus,
    eventBusName
  )
  
  t.is(response.statusCode, 200)
})

test('does not notify event bus when a non CAR file is added to the ucan store bucket', async t => {
  const bus = {
    putEvents: () => {
      throw new Error('event should not be triggered')
    }
  }

  const response = await notifyBus({
      // @ts-expect-error incomplete S3 event metadata
      Records: fixtureS3PutInvalidRecords
    },
    bus,
    eventBusName
  )
  t.is(response.statusCode, 200)
})
