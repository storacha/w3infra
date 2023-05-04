import { test } from '../helpers/context.js'
import {
  createS3,
  createBucket,
  createDynamodDb,
  createTable,
} from '../helpers/resources.js'
import { useProvisionsTable } from '../../tables/provisions.js'
import * as principal from '@ucanto/principal'
import {Signer} from '@ucanto/principal/ed25519'
import { Provider } from '@web3-storage/capabilities'
import { CID } from 'multiformats'
import { provisionsTableProps } from '../../tables/index.js'

test.before(async (t) => {
  Object.assign(t.context, {
    dynamo: await createDynamodDb(),
    // TODO move these constants to env vars - the private key is already public in w3up .env.tpl so it's safe to check in here too
    service: Signer.parse('MgCYWjE6vp0cn3amPan2xPO+f6EZ3I+KwuN1w2vx57vpJ9O0Bn4ci4jn8itwc121ujm7lDHkCW24LuKfZwIdmsifVysY=').withDID(
      'did:web:test.web3.storage'
    )
  })
})

/**
 * TODO: migrate back to test in w3up access-api/test/provisions.test.js
 */
test('should persist provisions', async (t) => {
  const { dynamo, service } = t.context
  const storage = useProvisionsTable(
    dynamo,
    await createTable(dynamo, provisionsTableProps),
    [service.did()]
  )
  const count = 2 + Math.round(Math.random() * 3)
  const spaceA = await principal.ed25519.generate()
  const [firstProvision, ...lastProvisions] = await Promise.all(
    Array.from({ length: count }).map(async () => {
      const issuerKey = await principal.ed25519.generate()
      const issuer = issuerKey.withDID('did:mailto:example.com:foo')
      const invocation = await Provider.add
        .invoke({
          issuer,
          audience: issuer,
          with: issuer.did(),
          nb: {
            consumer: spaceA.did(),
            provider: 'did:web:web3.storage:providers:w3up-alpha',
          },
        })
        .delegate()
      /** @type {import('../../access-types').Provision<'did:web:web3.storage:providers:w3up-alpha'>} */
      const provision = {
        invocation,
        space: spaceA.did(),
        provider: 'did:web:web3.storage:providers:w3up-alpha',
        account: issuer.did(),
      }
      return provision
    })
  )

  // TODO: I think this should fail because all of the provisions in lastProvisions have the same space and provider?!
  await Promise.all(lastProvisions.map((p) => storage.put(p)))
  t.deepEqual(await storage.count(), BigInt(lastProvisions.length))

  const spaceHasStorageProvider = await storage.hasStorageProvider(
    spaceA.did()
  )
  t.deepEqual(spaceHasStorageProvider, true)

  // ensure no error if we try to store same provision twice
  // all of lastProvisions are duplicate, but firstProvision is new so that should be added
  await storage.put(lastProvisions[0])
  await storage.put(firstProvision)
  t.deepEqual(await storage.count(), BigInt(count))

  // but if we try to store the same provision (same `cid`) with different
  // fields derived from invocation, it should error
  const modifiedFirstProvision = {
    ...firstProvision,
    space: /** @type {const} */ ('did:key:foo'),
    account: /** @type {const} */ ('did:mailto:example.com:foo'),
    // note this type assertion is wrong, but useful to set up the test
    provider: /** @type {import('@ucanto/interface').DID<'web'>} */ (
      'did:provider:foo'
    ),
  }
  const result = await storage.put(modifiedFirstProvision)
  t.is(
    result.error && result.name,
    'ConflictError',
    'cannot put with same cid but different derived fields'
  )
})

