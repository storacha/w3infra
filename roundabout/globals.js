import { TransformStream } from 'node:stream/web'
import { fetch } from 'undici'
globalThis.TransformStream = TransformStream
globalThis.fetch = fetch
