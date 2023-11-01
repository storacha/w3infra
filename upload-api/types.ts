import * as UCAN from '@ipld/dag-ucan'
import { DID, Link, Delegation, Signature, Block, UCANLink, ByteView, DIDKey, Result, Failure } from '@ucanto/interface'
import { UnknownLink } from 'multiformats'
import { CID } from 'multiformats/cid'
import { Kinesis } from '@aws-sdk/client-kinesis'
import { ProviderDID, Service } from '@web3-storage/upload-api'


export interface UcanLogCtx extends WorkflowCtx, ReceiptBlockCtx {
  basicAuth: string
}

export interface UcanStreamCtx {
  streamName: string
  kinesisClient?: Kinesis
}

export interface WorkflowCtx extends UcanStreamCtx {
  invocationBucket: InvocationBucket
  taskBucket: TaskBucket
  workflowBucket: WorkflowBucket
}

export interface ReceiptBlockCtx extends UcanStreamCtx {
  invocationBucket: InvocationBucket
  taskBucket: TaskBucket
  workflowBucket: WorkflowBucket
}

export interface InvocationBucket {
  putWorkflowLink: (cid: string, workflowCid: string) => Promise<void>
  putReceipt: (cid: string, bytes: Uint8Array) => Promise<void>
  putInLink: (cid: string, workflowCid: string) => Promise<void>
  putOutLink: (cid: string, workflowCid: string) => Promise<void>
  getInLink: (cid: string) => Promise<string | undefined>
  getWorkflowLink: (cid: string) => Promise<string | undefined>
}

export interface TaskBucket {
  putResult: (taskCid: string, bytes: Uint8Array) => Promise<void>
  putInvocationLink: (taskCid: string, invocationCid: string) => Promise<void>
}

export interface WorkflowBucket {
  put: (Cid: string, bytes: Uint8Array) => Promise<void>
  get: (Cid: string) => Promise<Uint8Array | undefined>
}

export interface DelegationsBucket {
  /** put a delegation into the delegations bucket */
  put: (cid: CID, bytes: ByteView<Delegation>) => Promise<void>
  /** get a delegation from the delegations bucket */
  get: (cid: CID) => Promise<ByteView<Delegation> | undefined>
}

export interface MetricsTable {
  /**
   * Get all metrics from table.
   */
  get: () => Promise<Record<string, any>[]>
}


export interface SpaceMetricsTable {
  /**
   * Return the total amount of storage a space has used.
   */
  getAllocated: (consumer: DIDKey) => Promise<number>
}

/**
 * 
 */
export interface SubscriptionInput {
  /** DID of the customer who maintains this subscription */
  customer: DID,
  /** DID of the provider who services this subscription */
  provider: DID,
  /** ID of this subscription - should be unique per-provider */
  subscription: string,
  /** CID of the invocation that created this subscription */
  cause: UCANLink
}

export interface SubscriptionTable {
  get: (provider: ProviderDID, subscription: string) =>
    Promise<{ customer: DID } | null>
  /** add a subscription - a relationship between a customer and a provider that will allow for provisioning of consumers */
  add: (consumer: SubscriptionInput) => Promise<{}>
  /** return the count of subscriptions in the system */
  count: () => Promise<bigint>
  /** return a list of the subscriptions a customer has with a provider */
  findProviderSubscriptionsForCustomer: (customer: DID, provider: DID) =>
    Promise<{ subscription: string }[]>
}

export interface ConsumerInput {
  /** the DID of the consumer (eg, a space) for whom services are being provisioned */
  consumer: DID,
  /** the DID of the provider who will provide services for the consumer */
  provider: DID,
  /** the ID of the subscription representing the relationship between the consumer and provider */
  subscription: string,
  /** the CID of the UCAN invocation that created this record */
  cause: UCANLink
}

export interface ConsumerRecord {
  /** the ID of the subscription representing the relationship between the consumer and provider */
  subscription: string,
  /** the CID of the UCAN invocation that created this record */
  cause: UCANLink
}

export interface ConsumerTable {
  /** get a consumer record for a given provider */
  get: (provider: ProviderDID, consumer: DIDKey) => Promise<{ subscription: string } | null>
  /** get a consumer record for a given subscription */
  getBySubscription: (provider: ProviderDID, subscription: string) => Promise<{ consumer: DID } | null>
  /** add a consumer - a relationship between a provider, subscription and consumer */
  add: (consumer: ConsumerInput) => Promise<{}>
  /** return the number of consumers */
  count: () => Promise<bigint>
  /** return a boolean indicating whether the given consumer has a storage provider */
  hasStorageProvider: (consumer: DID) => Promise<boolean>
  /** return a list of storage providers the given consumer has registered with */
  getStorageProviders: (consumer: DID) => Promise<ProviderDID[]>
}

// TODO: unify this with RecordNotFound in ../billing/tables/lib.js
export interface RecordNotFound<K> extends Failure {
  name: 'RecordNotFound'
  key: K
}

// TODO unify this with Customer in ../billing/lib/api.ts
export interface Customer {
  product: string
  updatedAt: string
}

// TODO unify this with CustomerStore in ../billing/lib/api.ts
export interface CustomerTable {
  /** get a customer record */
  get: (customer: DID<'mailto'>) => Promise<Result<Customer, RecordNotFound<DID<'mailto'>>>>
}

export type SpaceService = Pick<Service, "space">

export interface UcanInvocation {
  att: UCAN.Capabilities
  aud: `did:${string}:${string}`
  iss: `did:${string}:${string}`
  cid: string
}

export interface Workflow {
  cid: UnknownLink
  bytes: Uint8Array
  invocations: UcanInvocation[]
}

// TODO: Remove once in ucanto
export interface Receipt {
  ran: Link
  out: ReceiptResult
  meta: Record<string, unknown>
  iss?: DID
  prf?: Array<Link<Delegation>>
  s: Signature
}

// TODO: Remove once in ucanto
export interface ReceiptBlock extends Block<Receipt> {
  data: Receipt
}

// TODO: Remove once in ucanto
/**
 * Defines result type as per invocation spec
 *
 * @see https://github.com/ucan-wg/invocation/#6-result
 */
export type ReceiptResult<T = unknown, X extends {} = {}> = Variant<{
  ok: T
  error: X
}>

// TODO: Remove once in ucanto
export type Variant<U extends Record<string, unknown>> = {
  [Key in keyof U]: { [K in Exclude<keyof U, Key>]?: never } & {
    [K in Key]: U[Key]
  }
}[keyof U]

// would be generated by sst, but requires `sst build` to be run, which calls out to aws; not great for CI
declare module '@serverless-stack/node/config' {
  export interface SecretResources {
    PRIVATE_KEY: {
      value: string
    },
    UCAN_INVOCATION_POST_BASIC_AUTH: {
      value: string
    }
  }
}

export {}
