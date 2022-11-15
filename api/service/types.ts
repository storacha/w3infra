import type { Link, Principal, Invocation } from '@ucanto/interface'
import type { API, MalformedCapability } from '@ucanto/server'

export interface StoreServiceContext {
  id: Principal
  storeTable: StoreTable,
  signer: Signer
  carStoreBucket: CarStoreBucket,
  access: AccessClient
}

export interface UcantoServerContext extends StoreServiceContext {}

export interface CarStoreBucket {
  has: (key: string) => Promise<boolean>
}

export interface StoreTable {
  exists: (uploaderDID: string, payloadCID: string) => Promise<boolean>
  insert: (item: StoreItemInput) => Promise<StoreItemOutput>
  remove: (uploaderDID: string, payloadCID: string) => Promise<void>
  list: (uploaderDID: string) => Promise<ListResponse<StoreListResult>>
}

export interface Signer {
  sign: (link: Link<unknown, number, number, 0 | 1>) => { url: URL, headers: Record<string, string>}
}

export interface StoreItemInput {
  uploaderDID: string,
  link: string,
  origin?: string,
  size: number,
  proof: string,
}

export interface StoreItemOutput {
  uploaderDID: string,
  payloadCID: string,
  applicationDID: string,
  origin: string,
  size: number,
  proof: string,
  uploadedAt: string,
}

export interface StoreAddSuccessResult {
  status: 'upload' | 'done',
  with: API.URI<"did:">,
  link: API.Link<unknown, number, number, 0 | 1>,
  url?: URL,
  headers?: Record<string, string>
}

export type StoreAddResult = StoreAddSuccessResult | MalformedCapability

export type ListOptions = {
  pageSize?: number,
}

export interface StoreListResult {
  payloadCID: string
  origin: string
  size: number
  uploadedAt: number
}

export interface ListResponse<R> {
  cursorID?: string,
  pageSize: number,
  results: R[]
}

export interface AccessClient {
  /**
   * Determines if the issuer of the invocation has received a delegation
   * allowing them to issue the passed invocation.
   */
  verifyInvocation: (invocation: Invocation) => Promise<boolean>
}
