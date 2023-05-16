import { test } from '../helpers/context.js'
import {
  createDynamodDb,
  createTable,
} from '../helpers/resources.js'
import { useProvisionsTable } from '../../tables/provisions.js'
import * as principal from '@ucanto/principal'
import { Signer } from '@ucanto/principal/ed25519'
import { Provider } from '@web3-storage/capabilities'
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
 */
test('should persist provisions', async (t) => {
  const { dynamo, service } = t.context
  const storage = useProvisionsTable(
    dynamo,
    await createTable(dynamo, provisionsTableProps),
    [service.did()]
  )
  const spaceA = await principal.ed25519.generate()
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
  /** @type {import('@web3-storage/upload-api').Provision} */
  const provision = {
    cause: invocation,
    consumer: spaceA.did(),
    provider: 'did:web:web3.storage:providers:w3up-alpha',
    customer: issuer.did(),
  }

  t.deepEqual(await storage.count(), BigInt(0))

  const result = await storage.put(provision)
  t.falsy(result.error, 'adding a provision failed')
  t.deepEqual(await storage.count(), BigInt(1))

  const spaceHasStorageProvider = await storage.hasStorageProvider(
    spaceA.did()
  )
  t.deepEqual(spaceHasStorageProvider, true)

  // ensure no error if we try to store same provision twice
  const dupeResult = await storage.put(provision)
  t.falsy(dupeResult.error, 'putting the same provision twice did not succeed')
  t.deepEqual(await storage.count(), BigInt(1))

  const modifiedProvision = {
    ...provision,
    provider: /** @type {import('@ucanto/interface').DID<'web'>} */ (
      'did:provider:foo'
    ),
  }

  // ensure no error if we try to store a provision for a consumer that already has a provider
  const modifiedResult = await storage.put(modifiedProvision)
  t.truthy(modifiedResult.error, 'provisioning for a consumer who already has a provider succeeded and should not have!')
  t.deepEqual(await storage.count(), BigInt(1))
})

