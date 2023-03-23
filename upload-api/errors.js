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

export class BadContentTypeError extends HTTPError {
  constructor (msg = 'Bad content type header found') {
    super(msg, 400)
    this.name = 'BadContentType'
    this.code = BadContentTypeError.CODE
  }
}
BadContentTypeError.CODE = 'ERROR_BAD_CONTENT_TYPE'

export class BadBodyError extends HTTPError {
  constructor (msg = 'Bad body received') {
    super(msg, 400)
    this.name = 'BadBody'
    this.code = BadBodyError.CODE
  }
}
BadBodyError.CODE = 'ERROR_BAD_BODY'

export class NoInvocationFoundForGivenReceiptError extends HTTPError {
  constructor (msg = 'No invocation found for given receipt') {
    super(msg, 404)
    this.name = 'NoInvocationFoundForGivenReceipt'
    this.code = NoInvocationFoundForGivenReceiptError.CODE
  }
}
NoInvocationFoundForGivenReceiptError.CODE = 'ERROR_INVOCATION_NOT_FOUND_FOR_RECEIPT'

export class NoCarFoundForGivenReceiptError extends HTTPError {
  constructor (msg = 'No car found for given receipt') {
    super(msg, 404)
    this.name = 'NoCarFoundForGivenReceipt'
    this.code = NoCarFoundForGivenReceiptError.CODE
  }
}
NoCarFoundForGivenReceiptError.CODE = 'ERROR_CAR_NOT_FOUND_FOR_RECEIPT'

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
