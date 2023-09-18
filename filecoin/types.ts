import { UnknownLink } from 'multiformats'
import { PieceLink } from '@web3-storage/data-segment'

export interface PieceTable {
  insert: (item: PieceInsertInput) => Promise<Result<{}, PieceInsertError>>
}

export interface PieceInsertInput {
  link: UnknownLink
  piece: PieceLink
}

export type PieceInsertError = DatabaseOperationError | GetCarError | ComputePieceError

export interface DatabaseOperationError extends Error {
  name: 'DatabaseOperationFailed'
}
export interface GetCarError extends Error {
  name: 'GetCarFailed'
}
export interface ComputePieceError extends Error {
  name: 'ComputePieceFailed'
}

export class Failure extends Error {
  describe() {
    return this.toString()
  }
  get message() {
    return this.describe()
  }
  toJSON() {
    const { name, message, stack } = this
    return { name, message, stack }
  }
}

export type Result<T = unknown, X extends {} = {}> = Variant<{
  ok: T
  error: X
}>

/**
 * Utility type for defining a [keyed union] type as in IPLD Schema. In practice
 * this just works around typescript limitation that requires discriminant field
 * on all variants.
 *
 * ```ts
 * type Result<T, X> =
 *   | { ok: T }
 *   | { error: X }
 *
 * const demo = (result: Result<string, Error>) => {
 *   if (result.ok) {
 *   //  ^^^^^^^^^ Property 'ok' does not exist on type '{ error: Error; }`
 *   }
 * }
 * ```
 *
 * Using `Variant` type we can define same union type that works as expected:
 *
 * ```ts
 * type Result<T, X> = Variant<{
 *   ok: T
 *   error: X
 * }>
 *
 * const demo = (result: Result<string, Error>) => {
 *   if (result.ok) {
 *     result.ok.toUpperCase()
 *   }
 * }
 * ```
 *
 * [keyed union]:https://ipld.io/docs/schemas/features/representation-strategies/#union-keyed-representation
 */
export type Variant<U extends Record<string, unknown>> = {
  [Key in keyof U]: { [K in Exclude<keyof U, Key>]?: never } & {
    [K in Key]: U[Key]
  }
}[keyof U]
