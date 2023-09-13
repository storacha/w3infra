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

export const DatabaseOperationErrorName = /** @type {const} */ (
  'DatabaseOperationFailed'
)
export class DatabaseOperationFailed extends Failure {
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
export class GetCarFailed extends Failure {
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
export class ComputePieceFailed extends Failure {
  get reason() {
    return this.message
  }

  get name() {
    return ComputePieceErrorName
  }
}
