import { test } from './helpers/context.js'
import { composeCarStoresWithOrderedHas, createCarStore } from '../buckets/car-store.js'
import * as Link from 'multiformats/link'

test('car-store can be backed by S3 Client reading from R2', testR2CarStore)

/**
 * @todo remove this
 * @param {import('ava').ExecutionContext} t
 */
async function testR2CarStore(t) {
  // placeholder to get started
  // run with this from upload-api dir
  // node -r dotenv/config ../node_modules/.bin/ava test/car-store.test.js dotenv_config_path=../.env.local
  const bucketName = process.env.R2_CARPARK_BUCKET_NAME
  if ( ! bucketName) throw new Error('R2_CARPARK_BUCKET_NAME must be set')
  t.assert(process.env.R2_ENDPOINT)
  t.assert(process.env.R2_ACCESS_KEY_ID)
  t.assert(bucketName)
  const r2CarStore = createCarStore('auto', bucketName, {
    endpoint: process.env.R2_ENDPOINT || '',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },    
  })
  const knownHas = Link.parse('bagbaiera276fvwmtxaziv7ynb2xeb4vqmkoejmolfshzoqsfre7aki272qkq')
  const hasKnownHas = await r2CarStore.has(knownHas)
  t.assert(hasKnownHas)
}

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

/**
 * @param {Map<import('multiformats').UnknownLink, any>} map
 * @returns {import('@web3-storage/upload-api').CarStoreBucket>}
 */
function createMapCarStore(map=new Map) {
  return {
    async has(link) {
      return map.has(link)
    },
    createUploadUrl() {
      throw new Error('not implemented')
    }
  };
}
