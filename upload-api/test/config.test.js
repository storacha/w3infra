import { test } from './helpers/context.js'
import * as configModule from '../config.js'

/** keypair that can be used for testing */
const testKeypair = {
  private: {
    /**
     * Private key encoded as multiformats
     */
    multiformats:
      'MgCYWjE6vp0cn3amPan2xPO+f6EZ3I+KwuN1w2vx57vpJ9O0Bn4ci4jn8itwc121ujm7lDHkCW24LuKfZwIdmsifVysY=',
  },
  public: {
    /**
     * Public key encoded as a did:key
     */
    did: 'did:key:z6MkqBzPG7oNu7At8fktasQuS7QR7Tj7CujaijPMAgzdmAxD',
  },
}

test('getServiceSigner creates a signer using config.privateKey', async (t) => {
  const config = {
    privateKey: testKeypair.private.multiformats,
  }
  const signer = configModule.getServiceSigner(config)
  t.assert(signer)
  t.is(signer.did().toString(), testKeypair.public.did)
  const { keys } = signer.toArchive()
  const didKeys = Object.keys(keys)
  t.deepEqual(didKeys, [testKeypair.public.did])
})

test('getServiceSigner infers DID from config.privateKey when config.did is omitted', async (t) => {
  const config = {
    privateKey: testKeypair.private.multiformats,
  }
  const signer = configModule.getServiceSigner(config)
  t.assert(signer)
  t.is(signer.did().toString(), testKeypair.public.did)
})

test('getServiceSigner creates a signer using config.{did,privateKey}', async (t) => {
  const config = {
    privateKey: testKeypair.private.multiformats,
    did: 'did:web:exampe.com',
  }
  const principal = configModule.getServiceSigner(config)
  t.assert(principal)
  t.is(principal.did().toString(), config.did)
})

test('getServiceSigner errors if config.did is provided but not a DID', (t) => {
  t.throws(() => {
    configModule.getServiceSigner({
      did: 'not a did',
      privateKey: testKeypair.private.multiformats,
    })
  }, { message: /^Invalid DID/ })
})

test('parseServiceDids parses one DID', async (t) => {
  t.deepEqual(
    configModule.parseServiceDids('did:web:example.com'),
    ['did:web:example.com']
  )
})

test('parseServiceDids parses more than one DID', async (t) => {
  t.deepEqual(
    configModule.parseServiceDids('did:web:example.com,did:web:two.example.com'),
    ['did:web:example.com', 'did:web:two.example.com']
  )

  t.deepEqual(
    configModule.parseServiceDids('did:web:example.com,did:web:two.example.com,did:web:three.example.com'),
    ['did:web:example.com', 'did:web:two.example.com', 'did:web:three.example.com']
  )
})

test('parseServiceDids trims space around dids', async (t) => {
  t.deepEqual(
    configModule.parseServiceDids(' did:web:example.com, did:web:two.example.com '),
    ['did:web:example.com', 'did:web:two.example.com']
  )
})

test('parseServiceDids throws an exception if a non-DID is provided', async (t) => {
  t.throws(
    () => configModule.parseServiceDids('http://example.com'),
    { message: /^Invalid DID/}
  )
})

test('parseServiceDids throws an exception if a non-ServiceDID is provided', async (t) => {
  t.throws(
    () => configModule.parseServiceDids('did:mailto:abc123'),
    { message: /^Invalid ServiceDID/}
  )

  t.throws(
    () => configModule.parseServiceDids('did:key:z6Mkfy8k2JJUdNWCJtvzYrko5QRc7GXP6pksKDG19gxYzyi4'),
    { message: /^Invalid ServiceDID/}
  )
})