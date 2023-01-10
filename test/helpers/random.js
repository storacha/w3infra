import { webcrypto } from 'crypto'
import { Blob } from '@web-std/blob'

/** @param {number} size */
async function randomBytes(size) {
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
export async function randomFile(size) {
  const bytes = await randomBytes(size)
  return new Blob([bytes])
}
