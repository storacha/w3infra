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
