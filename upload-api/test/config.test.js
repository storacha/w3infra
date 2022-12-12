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

test('upload-api/config getServiceSigner creates a signer using config.{DID,PRIVATE_KEY}', async (t) => {
  const config = {
    PRIVATE_KEY: testKeypair.private.multiformats,
    DID: 'did:web:exampe.com',
  }
  const signer = configModule.getServiceSigner(config)
  t.assert(signer)
  t.is(signer.did().toString(), config.DID)
  const { keys } = signer.toArchive()
  const didKeys = Object.keys(keys)
  t.deepEqual(didKeys, [testKeypair.public.did])
})
test('upload-api/config getServiceSigner errors if config.DID is provided but not a did', (t) => {
  t.throws(() => {
    configModule.getServiceSigner({
      DID: 'not a did',
      PRIVATE_KEY: testKeypair.private.multiformats,
    })
  }, { message: /^Expected a did: but got ".+" instead$/ })
})
test('upload-api/config getServiceSigner infers did from config.PRIVATE_KEY when config.DID is omitted', async (t) => {
  const config = {
    PRIVATE_KEY: testKeypair.private.multiformats,
  }
  const signer = configModule.getServiceSigner(config)
  t.assert(signer)
  t.is(signer.did().toString(), testKeypair.public.did)
})
