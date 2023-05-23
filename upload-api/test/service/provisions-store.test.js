/* eslint-disable no-loop-func */
import { testProvisionsStorageVariant } from '@web3-storage/upload-api/test'
import { Signer } from '@ucanto/principal/ed25519'
import { test } from '../helpers/context.js'

import {
  createDynamodDb,
  createTable,
} from '../helpers/resources.js'
import { consumerTableProps, subscriptionTableProps } from '../../tables/index.js'
import { useProvisionStore } from '../../stores/provisions.js'
import { useConsumerTable } from '../../tables/consumer.js'
import { useSubscriptionTable } from '../../tables/subscription.js'

test.before(async (t) => {
  Object.assign(t.context, {
    dynamo: await createDynamodDb(),
    // TODO move these constants to env vars - the private key is already public in w3up .env.tpl so it's safe to check in here too
    service: Signer.parse('MgCYWjE6vp0cn3amPan2xPO+f6EZ3I+KwuN1w2vx57vpJ9O0Bn4ci4jn8itwc121ujm7lDHkCW24LuKfZwIdmsifVysY=').withDID(
      'did:web:test.web3.storage'
    )
  })
})

testProvisionsStorageVariant(
  async (/** @type {any} */ t) => {
    const { dynamo, service } = t.context
    const subscriptionTable = useSubscriptionTable(
      dynamo,
      await createTable(dynamo, subscriptionTableProps)
    )
    const consumerTable = useConsumerTable(
      dynamo,
      await createTable(dynamo, consumerTableProps)
    )
    return useProvisionStore(
      subscriptionTable,
      consumerTable,
      [service.did()]
    )
  },
  test
)