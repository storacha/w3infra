import { sha256 } from 'multiformats/hashes/sha2'
import * as raw from 'multiformats/codecs/raw'
import * as Link from 'multiformats/link'
import { randomInteger } from './math.js'
import { randomBytes } from './bytes.js'

export const randomBlock = () => {
  const bytes = randomBytes(randomInteger(1, 1024 * 1024))
  const mh = sha256.digest(bytes)
  if (mh instanceof Promise) throw new Error('sha256 hasher is async')
  return { cid: Link.create(raw.code, mh), bytes }
}

export const randomLink = () => randomBlock().cid
