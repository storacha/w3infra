import { Result, Failure } from '@ucanto/interface'
import { MultihashDigest } from 'multiformats'
import { QueueBatchAdder, StoreBatchPutter, Location, QueueOperationFailure, StoreOperationFailure, EncodeFailure } from '../../lib/api.js'

export interface BlockAdvertPublisherTestContext {
  multihashesQueue: QueueBatchAdder<MultihashDigest> & QueueRemover<MultihashDigest>
}

export interface BlockIndexWriterTestContext {
  blocksCarsPositionStore: StoreBatchPutter<Location> & StoreLister<MultihashDigest, Location>
}

export type TestContext =
  & BlockAdvertPublisherTestContext
  & BlockIndexWriterTestContext

export type Decoder<I, O> = (input: I) => Result<O, DecodeFailure>

export interface ListSuccess<R> {
  results: R[]
}

/** StoreLister allows items in the store to be listed. */
export interface StoreLister<K extends {}, V> {
  /** Lists items in the store. */
  list: (key: K) => Promise<Result<ListSuccess<V>, EncodeFailure|DecodeFailure|StoreOperationFailure>>
}

/** QueueRemover can remove items from the head of the queue. */
export interface QueueRemover<T> {
  /** Remove an item from the head of the queue. */
  remove: () => Promise<Result<T, EndOfQueue|DecodeFailure|QueueOperationFailure>>
}

/** EndOfQueue is a failure that occurs when there are no messages in a queue. */
export interface EndOfQueue extends Failure {
  name: 'EndOfQueue'
}

export interface RecordNotFound<K> extends Failure {
  name: 'RecordNotFound'
  key: K
}

export interface DecodeFailure extends Failure {
  name: 'DecodeFailure'
}

export type TestSuite<C> =
  Record<string, (assert: typeof import('entail').assert, ctx: C) => unknown>
