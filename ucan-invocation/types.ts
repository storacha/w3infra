import type { DID, Link } from '@ucanto/interface'
import { ToString, UnknownLink } from 'multiformats'
import { Ability, Capability, Capabilities } from '@ucanto/interface'

export interface MetricsTable {
  incrementStoreAddTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementStoreAddSizeTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
  incrementStoreRemoveTotal: (incrementSizeTotal: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
}

export interface TotalSizeCtx {
  metricsTable: MetricsTable
}

export interface UploadCountIncrement {
  space: DID,
  count: number
}
export interface SpaceMetricsTable {
  incrementUploadAddCount: (uploadAddInv: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
}

export interface SpaceMetricsTableCtx {
  spaceMetricsTable: SpaceMetricsTable
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
