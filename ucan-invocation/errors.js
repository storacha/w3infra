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
