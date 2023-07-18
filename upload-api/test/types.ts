import {DID, UCANLink} from '@ucanto/interface'

export interface StaticQueriesFixtures {
  consumer: DID,
  customer: DID,
  provider: DID,
  subscription: string,
  cause: UCANLink
}