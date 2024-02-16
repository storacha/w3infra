import { Ability, Delegation, Failure, Principal, Receipt, Resource, Result } from "@ucanto/interface"
import { ed25519 } from '@ucanto/principal'

export interface Task {
  do: Ability
  sub: Resource
  args: Record<string, any>
}

export interface AuthSecretParsingFailure extends Failure {}
export type AuthSecretHeaderParser = (headerValue: string) =>
  Promise<Result<ed25519.EdSigner, AuthorizationHeaderParsingFailure>>


export interface DelegationParsingError extends Failure {}
export type AuthorizationHeaderParsingFailure = DelegationParsingError
export type AuthorizationHeaderParser = (headerValue: string) =>
  Promise<Result<Delegation, AuthorizationHeaderParsingFailure>>

/**
 * The results of parsing a bridge request body.
 */
export interface BridgeRequestContent {
  /**
   * A list of tasks to be invoked
   */
  tasks: Task[]
}
export interface BodyParsingFailure extends Failure {}
export type BodyParser = (headerValue: string) => 
  Promise<Result<BridgeRequestContent, BodyParsingFailure>>

export type TasksExecutor = (
  issuer: ed25519.EdSigner,
  servicePrincipal: Principal,
  serviceURL: URL,
  tasks: Task[],
  proof: Delegation
) => Promise<Result<any, Failure>[]>