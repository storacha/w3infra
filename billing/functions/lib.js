/**
 * @param {Record<string, string|undefined>} obj
 * @param {string} key
 */
export const notNully = (obj, key) => {
  const value = obj[key]
  if (value == null) throw new Error(`${key} is null or undefined`)
  return value
}
