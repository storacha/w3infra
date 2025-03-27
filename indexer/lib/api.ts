import { Result, Failure, Unit } from '@ucanto/interface'

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

