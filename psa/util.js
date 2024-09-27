/**
 * @template T
 * @param {T} value
 */
export const okResponse = (value) => ({
  statusCode: 200,
  body: JSON.stringify({ ok: value })
})

/** @param {string} message */
export const errorResponse = (message, statusCode = 500) => ({
  statusCode,
  body: JSON.stringify({ error: { message } })
})
