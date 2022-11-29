import { test } from './helpers/context.js'

import { notifyBus } from '../event-bus/source.js'
import { eipfsHandler } from '../event-bus/eipfs-indexer.js'

import {
  s3PutInvalidRecords as fixtureS3PutInvalidRecords,
  s3PutValidRecords as fixtureS3PutValidRecords
} from './fixtures.js'

const eventBusName = 'event-bus-arn'

test('notifies event bus when new carpark bucket is written', async t => {
  const bus = {
    putEvents: (/** @type {any} */ data) => {
      t.is(data.Entries.length, fixtureS3PutValidRecords.length)
      for (let i = 0; i < data.Entries.length; i++) {
        const entry = data.Entries[i]

        t.is(entry.EventBusName, eventBusName)
        t.is(entry.Source, 'carpark_bucket')
        t.is(entry.DetailType, 'car_added')

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

test('does not notify event bus when carpark bucket is written with non CAR files', async t => {
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

test('E-IPFS event handler sends message to SQS', async t => {
  const url = 'localhost:9000'
  const bridgeEvent = {
    detail: {
      key: 'bafkreigfrvnqxtgyazq2x5bzljvhrag3xfnfl4jnjvdiewc2fqb5vz5ddu/bagbaieraujbjejtyjrx3qkwk4plekotl2oxwclil7sddc4fpdb5nl5mandjq.car',
      region: 'us-west-2',
      bucketName: 'carpark-prod-0'
    }
  }

  const sqsClient = {
    send: (/** @type {any} */ messageCommand) => {
      t.is(messageCommand.input.QueueUrl, url)
      t.is(messageCommand.input.MessageBody, `${bridgeEvent.detail.region}/${bridgeEvent.detail.bucketName}/${bridgeEvent.detail.key}`)

      return Promise.resolve()
    }
  }

  // @ts-expect-error SQS mock client is partially implemented
  await eipfsHandler(bridgeEvent, sqsClient, url)
})
