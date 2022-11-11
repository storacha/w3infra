import { StoreTable } from '../database/store'

export interface StoreServiceContext {
  storeTable: StoreTable,
  signingOptions: SigningOptions
  carStore: CarStore,
}

export interface UcantoServerContext extends StoreServiceContext {}

export interface CarStore {
  has: (key: string) => Promise<boolean>
}

export interface SigningOptions {
  region: string,
  secretAccessKey: string,
  accessKeyId: string,
  bucket: string,
  sessionToken: string,
}
