/**
 * @param {string} name
 * @returns {string}
 */
export const mustGetEnv = name => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}

/**
 * @template {{}} T
 * @param {import('@ucanto/interface').Result<T>} result
 * @param {string} [message]
 */
export const expect = (result, message = 'Unexpected error') => {
  if (result.ok) {
     return result.ok
  } else {
    throw Object.assign(new Error(message), { cause: result.error })
  }
}
