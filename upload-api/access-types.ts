import * as Ucanto from '@ucanto/interface'
import { ProviderAdd } from '@web3-storage/capabilities/src/types'

interface ByAudience {
  audience: Ucanto.DID<'key' | 'mailto'>
}
export type Query = ByAudience


/**
 * TODO use the version in w3up access-api/src/types/delegations.ts
 */
export interface DelegationsStorage<
  Cap extends Ucanto.Capability = Ucanto.Capability
> {
  /**
   * write several items into storage
   *
   * @param delegations - delegations to store
   */
  putMany: (
    ...delegations: Array<Ucanto.Delegation<Ucanto.Tuple<Cap>>>
  ) => Promise<unknown>

  /**
   * get number of stored items
   */
  count: () => Promise<bigint>

  /**
   * find all items that match the query
   */
  find: (query: Query) => AsyncIterable<Ucanto.Delegation<Ucanto.Tuple<Cap>>>
}

/**
 * action which results in provisionment of a space consuming a storage provider
 * TODO use the version in w3up access-api/src/types/provisions.ts
 */
export interface Provision<ServiceDID extends Ucanto.DID<'web'>> {
  invocation: Ucanto.Invocation<ProviderAdd>
  space: Ucanto.DID<'key'>
  account: Ucanto.DID<'mailto'>
  provider: ServiceDID
}

/**
 * stores instances of a storage provider being consumed by a consumer
 * TODO use the version in w3up access-api/src/types/provisions.ts
 */
export interface ProvisionsStorage<
  ServiceDID extends Ucanto.DID<'web'> = Ucanto.DID<'web'>
> {
  services: ServiceDID[]
  hasStorageProvider: (consumer: Ucanto.DID<'key'>) => Promise<boolean>
  /**
   * ensure item is stored
   *
   * @param item - provision to store
   */
  put: (
    item: Provision<ServiceDID>
  ) => Promise<Ucanto.Result<{}, Ucanto.Failure>>

  /**
   * get number of stored items
   */
  count: () => Promise<bigint>
}