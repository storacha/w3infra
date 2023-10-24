import { Result, Failure } from '@ucanto/interface'
import {
  CustomerStore,
  StorePutter,
  CustomerBillingQueue,
  Customer,
  CustomerBillingInstruction,
  DecodeFailure,
  QueueOperationFailure
} from '../../lib/api.js'

export interface TestContext {
  customerStore: CustomerStore & StorePutter<Customer>
  customerBillingQueue: CustomerBillingQueue & QueueRemover<CustomerBillingInstruction>
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

export type TestSuite =
  Record<string, (assert: typeof import('entail').assert, ctx: TestContext) => unknown>
