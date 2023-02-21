import type { DID, Link } from '@ucanto/interface'
import { ToString, UnknownLink } from 'multiformats'
import { Ability, Capability, Capabilities } from '@ucanto/interface'

export interface W3MetricsTable {
  incrementAccumulatedSize: (incrementTotalSize: Capability<Ability, `${string}:${string}`, unknown>[]) => Promise<void>
}

export interface W3AccumulatedSizeCtx {
  w3MetricsTable: W3MetricsTable
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
