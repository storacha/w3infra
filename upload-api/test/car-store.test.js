import { test } from './helpers/context.js'
import { composeCarStoresWithOrderedHas, createMapCarStore } from '../buckets/car-store.js'
import * as Link from 'multiformats/link'

test('can compose carStores', testCanComposeCarStores)

/**
 * @param {import('ava').ExecutionContext} t
 */
async function testCanComposeCarStores(t) {
  const linkA = Link.parse('bafybeicsrmze45wea5q4v66i2wh2ecevnalvtx76xapt2efofw55owhhbu')
  const carStore1 = createMapCarStore()
  const carStore2 = createMapCarStore(new Map([
    [linkA, true],
  ]))
  const carStoreComposed = composeCarStoresWithOrderedHas(carStore1, carStore2)
  t.assert(await carStoreComposed.has(linkA))
}
