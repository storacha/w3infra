/**
 * @param {string} name 
 * @returns {string}
 */
export function mustGetEnv (name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}
