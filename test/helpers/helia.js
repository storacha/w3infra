import { noise } from '@chainsafe/libp2p-noise'
import { webSockets } from '@libp2p/websockets'
import { identify } from '@libp2p/identify'
import { createLibp2p } from 'libp2p'
import { mplex } from '@libp2p/mplex'
import { createHelia } from 'helia'

export async function createNode () {
  console.log('Creating local libp2p')
  const libp2p = await createLibp2p({
    connectionEncryption: [noise()],
    transports: [webSockets()],
    streamMuxers: [mplex()],
    services: {
      identify: identify()
    }
  })

  console.log('Creating local helia')
  const helia = await createHelia({
    libp2p
  })

  return helia
}
