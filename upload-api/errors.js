export class HTTPError extends Error {
  /**
   *
   * @param {string} message
   * @param {number} [status]
   */
  constructor (message, status = 500) {
    super(message)
    this.name = 'HTTPError'
    this.status = status
  }
}

export class NoTokenError extends HTTPError {
  constructor (msg = 'No token found in `Authorization: Basic ` header') {
    super(msg, 401)
    this.name = 'NoToken'
    this.code = NoTokenError.CODE
  }
}
NoTokenError.CODE = 'ERROR_NO_TOKEN'

export class ExpectedBasicStringError extends HTTPError {
  constructor (msg = 'Expected argument to be a string in the `Basic {token}` format') {
    super(msg, 407)
    this.name = 'ExpectedBasicString'
    this.code = ExpectedBasicStringError.CODE
  }
}
ExpectedBasicStringError.CODE = 'ERROR_NO_TOKEN'

export class NoValidTokenError extends HTTPError {
  constructor (msg = 'Provided token is not valid') {
    super(msg, 403)
    this.name = 'NoValidToken'
    this.code = NoValidTokenError.CODE
  }
}
NoValidTokenError.CODE = 'ERROR_NO_VALID_TOKEN'
