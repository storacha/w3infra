import * as ed25519 from '@ucanto/principal/ed25519'

export default async function getServiceDid() {
  // This is a Fixture for now, let's see how config is in current w3up project with secrets + env vars

  /** did:key:z6MkrZ1r5XBFZjBU34qyD8fueMbMRkKw17BZaq2ivKFjnz2z */
  return ed25519.parse(
  'MgCYKXoHVy7Vk4/QjcEGi+MCqjntUiasxXJ8uJKY0qh11e+0Bs8WsdqGK7xothgrDzzWD0ME7ynPjz2okXDh8537lId8='
  )
}
