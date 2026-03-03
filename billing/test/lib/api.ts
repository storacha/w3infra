import { Result, Failure } from '@ucanto/interface'
import {
  CustomerStore,
  StorePutter,
  StoreLister,
  CustomerBillingQueue,
  Customer,
  CustomerBillingInstruction,
  DecodeFailure,
  QueueOperationFailure,
  SpaceBillingQueue,
  SpaceBillingInstruction,
  SubscriptionStore,
  ConsumerStore,
  Subscription,
  Consumer,
  SpaceDiffStore,
  SpaceSnapshotStore,
  UsageStore,
  UsageListKey,
  Usage,
  EgressTrafficQueue,
  EgressTrafficData,
  EgressTrafficEventStore,
  EgressTrafficMonthlyStore
} from '../../lib/api.js'
import { Context, Handler, SQSEvent } from 'aws-lambda'
import Stripe from 'stripe'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'

export interface BillingCronTestContext {
  customerStore: CustomerStore & StorePutter<Customer>
  customerBillingQueue: CustomerBillingQueue & QueueRemover<CustomerBillingInstruction>
}

export interface CustomerBillingQueueTestContext {
  subscriptionStore: SubscriptionStore & StorePutter<Subscription>
  consumerStore: ConsumerStore & StorePutter<Consumer>
  spaceBillingQueue: SpaceBillingQueue & QueueRemover<SpaceBillingInstruction>
}

export interface SpaceBillingQueueTestContext {
  spaceDiffStore: SpaceDiffStore
  spaceSnapshotStore: SpaceSnapshotStore
  usageStore: UsageStore & StoreLister<UsageListKey, Usage>
}

export interface StripeTestContext {
  customerStore: CustomerStore
}

export interface EgressTrafficTestContext extends Context {
  egressTrafficQueue: EgressTrafficQueue & QueueRemover<EgressTrafficData>
  egressTrafficQueueUrl: string
  egressTrafficHandler: Handler<SQSEvent, any>
  accountId: string
  region: string
  customerTable: string
  customerStore: CustomerStore
  egressTrafficMonthlyTable: string
  dynamoClient: DynamoDBClient
  egressTrafficTable: string
  egressTrafficEventStore: EgressTrafficEventStore
  billingMeterEventName: string
  billingMeterId: string
  stripeSecretKey: string
  stripe: Stripe
}

export interface EgressMonthlyTestContext extends Context {
  egressTrafficQueue: EgressTrafficQueue & QueueRemover<EgressTrafficData>
  egressTrafficQueueUrl: string
  accountId: string
  region: string
  customerTable: string
  customerStore: CustomerStore & StorePutter<Customer>
  egressTrafficTable: string
  egressTrafficEventStore: EgressTrafficEventStore
  egressTrafficMonthlyTable: string
  egressTrafficMonthlyStore: EgressTrafficMonthlyStore
}

export type TestContext =
  & BillingCronTestContext
  & CustomerBillingQueueTestContext
  & SpaceBillingQueueTestContext
  & StripeTestContext
  & EgressTrafficTestContext
  & EgressMonthlyTestContext

/** QueueRemover can remove items from the head of the queue. */
export interface QueueRemover<T> {
  /** Remove an item from the head of the queue. */
  remove: () => Promise<Result<T, EndOfQueue|DecodeFailure|QueueOperationFailure>>
}

/** EndOfQueue is a failure that occurs when there are no messages in a queue. */
export interface EndOfQueue extends Failure {
  name: 'EndOfQueue'
}

export type TestSuite<C> =
  Record<string, (assert: typeof import('entail').assert, ctx: C) => unknown>
