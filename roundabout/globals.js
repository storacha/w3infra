// CARReaderStream used by content-claims client expects global TransformStream and fetch
import { TransformStream } from 'node:stream/web'
import { fetch } from 'undici'
globalThis.TransformStream = TransformStream
globalThis.fetch = fetch
