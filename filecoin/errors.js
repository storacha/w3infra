import * as Server from '@ucanto/server'

export const DecodeBlockOperationErrorName = /** @type {const} */ (
  'DecodeBlockOperationError'
)
export class DecodeBlockOperationError extends Server.Failure {
  get reason() {
    return this.message
  }

  get name() {
    return DecodeBlockOperationErrorName
  }
}

export const NotFoundWorkflowErrorName = /** @type {const} */ (
  'NotFoundWorkflowError'
)
export class NotFoundWorkflowError extends Server.Failure {
  get reason() {
    return this.message
  }

  get name() {
    return NotFoundWorkflowErrorName
  }
}

export const GetCarErrorName = /** @type {const} */ (
  'GetCarFailed'
)
export class GetCarFailed extends Error {
  get reason() {
    return this.message
  }

  get name() {
    return GetCarErrorName
  }
}

export const ComputePieceErrorName = /** @type {const} */ (
  'ComputePieceFailed'
)
export class ComputePieceFailed extends Error {
  get reason() {
    return this.message
  }

  get name() {
    return ComputePieceErrorName
  }
}
