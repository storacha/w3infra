/**
 * @param {string} name
 * @returns {string}
 */
export const mustGetEnv = name => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}
