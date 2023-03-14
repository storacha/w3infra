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
  incrementUploadAddCount: (uploadAddInv: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementStoreAddSizeTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementStoreRemoveSizeTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
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

export interface UcanInvocation {
  carCid: string,
  value: UcanInvocationValue,
  ts: number
}

export interface UcanInvocationValue {
  att: Capabilities,
  aud: DID,
  iss?: DID,
  prf?: LinkJSON<Link>[]
}

export interface LinkJSON<T extends UnknownLink = UnknownLink> {
  '/': ToString<T>
}
