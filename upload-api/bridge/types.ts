import { Ability, DID, Delegation, Failure, Principal, Result } from "@ucanto/interface"
import { ed25519 } from '@ucanto/principal'

export interface UnexpectedFailure extends Failure {}

export interface ParsedRequest {
  authorizationHeader?: string
  authSecretHeader?: string
  contentType?: string
  body?: ReadableStream
}

export interface Task {
  do: Ability
  sub: DID
  args: Record<string, any>
}

export type AuthSecretHeaderParsingFailure = UnexpectedFailure
export type AuthSecretHeaderParser = (headerValue: string) =>
  Promise<Result<ed25519.EdSigner, AuthSecretHeaderParsingFailure>>


export interface DelegationParsingError extends Failure {}
export type AuthorizationHeaderParsingFailure = DelegationParsingError | UnexpectedFailure
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

export interface UnknownContentType extends Failure {}
export type BodyParsingFailure = UnknownContentType | UnexpectedFailure

export type BodyParser = (contentType: string, body: ReadableStream) =>
  Promise<Result<BridgeRequestContent, BodyParsingFailure>>

export interface InvalidTask extends Failure {}
export type TaskParsingFailure = UnexpectedFailure
export type TaskParser = (task: unknown) =>
  Promise<Result<Task, TaskParsingFailure>>

export interface InvalidTasks extends Failure {}
export type TasksParsingFailure = InvalidTasks | UnexpectedFailure
export type TasksParser = (tasks: unknown) =>
  Promise<Result<Task[], TasksParsingFailure>>

export type TasksExecutionFailure = UnexpectedFailure
export type TasksExecutor = (
  issuer: ed25519.EdSigner,
  servicePrincipal: Principal,
  serviceURL: URL,
  tasks: Task[],
  proof: Delegation
) => Promise<Result<any, TasksExecutionFailure>[]>

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
