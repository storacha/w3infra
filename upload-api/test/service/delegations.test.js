/* eslint-disable no-loop-func */
import { test } from '../helpers/context.js'
import * as principal from '@ucanto/principal'
import * as Ucanto from '@ucanto/interface'
import * as ucanto from '@ucanto/core'
import * as assert from 'node:assert'
import { collect } from 'streaming-iterables'
import {
  createS3,
  createBucket,
  createDynamodDb,
  createTable,
} from '../helpers/resources.js'
import { delegationsTableProps } from '../../tables/index.js'
import { useDelegationsTable } from '../../tables/delegations.js'
import { useDelegationsStore } from '../../buckets/delegations-store.js'

/**
 * 
 * TODO: migrate back to function originally defined in w3up access-api/src/utils/ucan.js
 * 
 * @param {object} options
 * @param {PromiseLike<principal.ed25519.EdSigner>} [options.audience]
 * @param {PromiseLike<principal.ed25519.EdSigner>} [options.issuer]
 * @param {Ucanto.URI} [options.with]
 * @param {Ucanto.Ability} [options.can]
 */
export async function createSampleDelegation(options = {}) {
  const {
    issuer = Promise.resolve(principal.ed25519.generate()),
    audience = Promise.resolve(principal.ed25519.generate()),
    can,
  } = options
  const delegation = await ucanto.delegate({
    issuer: await issuer,
    audience: await audience,
    capabilities: [
      {
        with: options.with || 'urn:',
        can: can || 'test/*',
      },
    ],
  })
  return delegation
}

/**
 * 
 *  * TODO: migrate back to function originally defined in w3up access-api/test/delegations-storage.testjs

 * @param {object} [opts]
 * @param {Ucanto.Signer<Ucanto.DID>} [opts.issuer]
 * @param {Ucanto.Principal} [opts.audience]
 * @param {Ucanto.Capabilities} [opts.capabilities]
 * @returns {Promise<Ucanto.Delegation>}
 */
async function createDelegation(opts = {}) {
  const {
    issuer = await principal.ed25519.generate(),
    audience = issuer,
    capabilities = [
      {
        can: 'test/*',
        with: issuer.did(),
      },
    ],
  } = opts
  return await ucanto.delegate({
    issuer,
    audience,
    capabilities,
  })
}

test.before(async (t) => {
  Object.assign(t.context, {
    dynamo: await createDynamodDb(),
    s3: (await createS3()).client,
  })
})

// TODO migrate back to using testVariant in w3up access-api/test/delegations-storage.test.js
test('should persist delegations', async (t) => {
  const { dynamo, s3 } = t.context
  const bucketName = await createBucket(s3)
  const delegationsBucket = useDelegationsStore(s3, bucketName)
  const delegationsStorage = useDelegationsTable(
    dynamo,
    await createTable(dynamo, delegationsTableProps),
    delegationsBucket
  )
  const count = Math.round(Math.random() * 10)
  const delegations = await Promise.all(
    Array.from({ length: count }).map(() => createSampleDelegation())
  )
  await delegationsStorage.putMany(...delegations)
  t.deepEqual(await delegationsStorage.count(), BigInt(delegations.length))
})

// TODO migrate back to using testVariant in w3up access-api/test/delegations-storage.test.js
test('can retrieve delegations by audience', async (t) => {
  const { dynamo, s3 } = t.context
  const bucketName = await createBucket(s3)
  const delegationsBucket = useDelegationsStore(s3, bucketName)
  const delegations = useDelegationsTable(
    dynamo,
    await createTable(dynamo, delegationsTableProps),
    delegationsBucket
  )
  const issuer = await principal.ed25519.generate()

  const alice = await principal.ed25519.generate()
  const delegationsForAlice = await Promise.all(
    Array.from({ length: 1 }).map(() =>
      createDelegation({ issuer, audience: alice })
    )
  )

  const bob = await principal.ed25519.generate()
  const delegationsForBob = await Promise.all(
    Array.from({ length: 2 }).map((e, i) =>
      createDelegation({
        issuer,
        audience: bob,
        capabilities: [
          {
            can: `test/${i}`,
            with: alice.did(),
          },
        ],
      })
    )
  )

  await delegations.putMany(...delegationsForAlice, ...delegationsForBob)

  const aliceDelegations = await collect(
    delegations.find({ audience: alice.did() })
  )
  t.deepEqual(aliceDelegations.length, delegationsForAlice.length)

  const bobDelegations = await collect(
    delegations.find({ audience: bob.did() })
  )
  t.deepEqual(bobDelegations.length, delegationsForBob.length)

  const carol = await principal.ed25519.generate()
  const carolDelegations = await collect(
    delegations.find({ audience: carol.did() })
  )
  t.deepEqual(carolDelegations.length, 0)
})

