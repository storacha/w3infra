export const DatabaseOperationErrorName = /** @type {const} */ (
  'DatabaseOperationFailed'
)
export class DatabaseOperationFailed extends Error {
  get reason() {
    return this.message
  }

  get name() {
    return DatabaseOperationErrorName
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
