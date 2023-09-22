// NOTE: shim globals needed by content-claims client deps that would be present in nodejs v18.
// TODO: migrate to sst v2 and nodejs v18+
import { TransformStream, WritableStream, CountQueuingStrategy } from 'node:stream/web'
import { fetch } from 'undici'
globalThis.TransformStream = TransformStream
globalThis.CountQueuingStrategy = CountQueuingStrategy
globalThis.WritableStream = WritableStream
globalThis.fetch = fetch
