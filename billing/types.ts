import { DID, Link, LinkJSON, Result, Capabilities } from '@ucanto/interface'

// TODO: replace `UcanInvocation` type in `ucan-invocation/types.ts` with this?
export interface UcanMessage<C extends Capabilities = Capabilities> {
  carCid: string
  value: UcanMessageValue<C>
  ts: number
}

export interface UcanMessageValue<C extends Capabilities = Capabilities> {
  att: C,
  aud: DID,
  iss?: DID,
  prf?: Array<LinkJSON<Link>>
}

export interface UcanReceiptMessage<
  C extends Capabilities = Capabilities,
  R extends Result = Result
> extends UcanMessage<C> {
  type: 'receipt'
  out: R
}

export interface UcanWorkflowMessage<C extends Capabilities = Capabilities> extends UcanMessage<C> {
  type: 'workflow'
}

export type UcanStreamMessage<C extends Capabilities = Capabilities> = UcanWorkflowMessage<C> | UcanReceiptMessage<C>

export interface SpaceSizeDiffRecord {
  account: DID
  space: DID
  cause: Link
  change: number
}

export interface SpaceSizeDiffTable {
  putAll: (records: SpaceSizeDiffRecord[]) => Promise<void>
}
