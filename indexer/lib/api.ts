import { Result, Failure, Unit } from '@ucanto/interface'
import { MultihashDigest } from 'multiformats'

export type Encoder<I, O> = (input: I) => Result<O, EncodeFailure>

export interface EncodeFailure extends Failure {
  name: 'EncodeFailure'
}

export interface QueueOperationFailure extends Failure {
  name: 'QueueOperationFailure'
}

export interface StoreOperationFailure extends Failure {
  name: 'StoreOperationFailure'
}

/** QueueBatchAdder allows multiple messages to be added to the end of the queue. */
export interface QueueBatchAdder<T> {
  /** Adds multiple messages to the end of the queue. */
  batchAdd: (message: T[]) => Promise<Result<Unit, EncodeFailure|QueueOperationFailure|Failure>>
}

/** StoreBatchPutter allows multiple items to be put in the store by their key. */
export interface StoreBatchPutter<T> {
  /** Puts multiple items into the store by their key */
  batchPut: (rec: T[]) => Promise<Result<Unit, EncodeFailure|StoreOperationFailure|Failure>>
}

export interface Location {
  digest: MultihashDigest
  location: URL
  range: [number, number]
}

export interface BlocksCarsPositionRecord {
  blockmultihash: string
  carpath: string
  offset: number
  length: number
}
