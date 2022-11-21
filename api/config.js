/**
 * This file uses SSTs magic Config handler.
 * If you depend on it in a test then you need to use the `sst bind` CLI to setup the config object.
 
 * see: https://docs.sst.dev/config
 * see: https://docs.sst.dev/advanced/testing#how-sst-bind-works
 */
import * as ed25519 from '@ucanto/principal/ed25519'
import { Config } from '@serverless-stack/node/config/index.js'

export function getServiceSigner() {
  return ed25519.parse(Config.PRIVATE_KEY)
}
