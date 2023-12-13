import type { DID, Link } from '@ucanto/interface'
import { ToString, UnknownLink } from 'multiformats'
import { Ability, Capability, Capabilities } from '@ucanto/interface'

export interface MetricsTable {
  incrementStoreAddTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementStoreAddSizeTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementStoreRemoveTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementStoreRemoveSizeTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementUploadAddTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementUploadRemoveTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
}

export interface CarStoreBucket {
  getSize: (link: UnknownLink) => Promise<number>
}

export interface TotalSizeCtx {
  metricsTable: MetricsTable
}

export interface UploadCountIncrement {
  space: DID,
  count: number
}
export interface SpaceMetricsTable {
  incrementStoreAddCount: (storeAddInv: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementStoreRemoveCount: (storeRemoveInv: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementStoreAddSizeTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementStoreRemoveSizeTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementUploadAddCount: (uploadAddInv: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementUploadRemoveCount: (uploadAddInv: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
}
export interface SpaceMetricsTableCtx {
  spaceMetricsTable: SpaceMetricsTable
}

export interface RemoveSizeCtx {
  metricsTable: MetricsTable
  carStoreBucket: CarStoreBucket
}
export interface MetricsBySpaceWithBucketCtx {
  spaceMetricsTable: SpaceMetricsTable
  carStoreBucket: CarStoreBucket
}

export type UcanInvocationType = 'workflow' | 'receipt'

export interface UcanInvocation {
  carCid: string
  invocationCid: string
  value: UcanInvocationValue
  ts: number
  type: UcanInvocationType
  out?: ReceiptResult
}

export interface UcanInvocationValue {
  att: Capabilities
  aud: DID
  iss?: DID
  prf?: LinkJSON<Link>[]
}

export interface LinkJSON<T extends UnknownLink = UnknownLink> {
  '/': ToString<T>
}

/**
 * Defines result type as per invocation spec
 *
 * @see https://github.com/ucan-wg/invocation/#6-result
 */
export type ReceiptResult<T = unknown, X extends {} = {}> = Variant<{
  ok: T
  error: X
}>

export type Variant<U extends Record<string, unknown>> = {
  [Key in keyof U]: { [K in Exclude<keyof U, Key>]?: never } & {
    [K in Key]: U[Key]
  }
}[keyof U]
