import type { Link } from '@ucanto/interface'

export interface StoreServiceContext {
  storeTable: StoreTable,
  signer: Signer
  carStoreBucket: CarStoreBucket,
}

export interface UcantoServerContext extends StoreServiceContext {}

export interface CarStoreBucket {
  has: (key: string) => Promise<boolean>
}

export interface StoreTable {
  exists: (uploaderDID: string, payloadCID: string) => Promise<boolean>
  insert: (item: StoreItemInput) => Promise<StoreItemOutput>
}

export interface Signer {
  sign: (link: Link<unknown, number, number, 0 | 1>) => { url: URL, headers: Record<string, string>}
}

export interface StoreItemInput {
  uploaderDID: string,
  link: string,
  origin: string,
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
