import { webcrypto } from 'crypto'
import { CarWriter } from '@ipld/car'
import { CID } from 'multiformats/cid'
import * as Link from 'multiformats/link'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import * as CAR from '@ucanto/transport/car'
import * as ed25519 from '@ucanto/principal/ed25519'

/** @param {number} size */
export async function randomBytes(size) {
  const bytes = new Uint8Array(size)
  while (size) {
    const chunk = new Uint8Array(Math.min(size, 65_536))
    webcrypto.getRandomValues(chunk)

    size -= bytes.length
    bytes.set(chunk, size)
  }
  return bytes
}

/** @param {number} size */
export async function randomBlob(size) {
  const bytes = await randomBytes(size)
  const multihash = await sha256.digest(bytes)
  const digest = multihash.bytes
  const blobSize = bytes.byteLength
  const cid = Link.create(raw.code, multihash)

  return { digest, size: blobSize, cid }
}

export async function randomCID() {
  const bytes = await randomBytes(10)
  const hash = await sha256.digest(bytes)
  return CID.create(1, raw.code, hash)
}

/** @param {number} size */
export async function randomCAR(size) {
  const bytes = await randomBytes(size)
  const hash = await sha256.digest(bytes)
  const root = CID.create(1, raw.code, hash)

  const { writer, out } = CarWriter.create(root)
  writer.put({ cid: root, bytes })
  writer.close()

  const chunks = []
  for await (const chunk of out) {
    chunks.push(chunk)
  }
  const blob = new Blob(chunks)
  const cid = await CAR.codec.link(new Uint8Array(await blob.arrayBuffer()))

  return Object.assign(blob, { cid, roots: [root] })
}

export const randomDID = async () => {
  const signer = await ed25519.generate()
  return signer.did()
}
