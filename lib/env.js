/**
 * Get the environment variable or throw an error if not set.
 *
 * @param {string} name
 * @returns {string}
 */
export const mustGetEnv = name => mustGetVal(process.env, name)

/**
 * @param {Record<string, string|undefined>} obj 
 * @param {string} name 
 * @returns {string}
 */
export const mustGetVal = (obj, name) => {
  const value = obj[name]
  if (!value) throw new Error(`Missing value for key: ${name}`)
  return value
}
