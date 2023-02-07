import { test } from './helpers/context.js'

import { notifyBus, REPLICATOR_EVENT_BRIDGE_SOURCE_EVENT } from '../event-bus/index.js'

const eventBusName = 'event-bus-arn'

test('notifies event bus when new file is replicated', async t => {
  const detail = {
    key: 'bafyfoo/bafyfoo.car',
    url: 'https://endpoint.io/bafyfoo/bafyfoo.car'
  }
  const bus = {
    putEvents: (/** @type {any} */ data) => {
      t.is(data.Entries.length, 1)
      for (let i = 0; i < data.Entries.length; i++) {
        const entry = data.Entries[i]

        t.is(entry.EventBusName, eventBusName)
        t.is(entry.Source, REPLICATOR_EVENT_BRIDGE_SOURCE_EVENT)
        t.is(entry.DetailType, 'file_replicated')

        const entryDetail = JSON.parse(entry.Detail)
        t.deepEqual(entryDetail, detail)
      }
      return {
        promise: () => Promise.resolve(data)
      }
    }
  }

  await notifyBus(
    detail,
    // @ts-expect-error non complete event bus implementation
    bus,
    eventBusName
  )
})
