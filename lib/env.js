import { Config } from 'sst/node/config'

/**
 * Get the environment variable or throw an error if not set.
 *
 * @param {string} name
 * @returns {string}
 */
export const mustGetEnv = name => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}

/**
 * Get a value from SST Config or throw an error if not set.
 * Use this for Config.Parameter values that are required.
 *
 * @template {keyof import('sst/node/config').ParameterResources} K
 * @param {K} name - The parameter name
 * @returns {string}
 */
export const mustGetConfig = (name) => {
  const value = Config[name]
  if (!value) throw new Error(`Missing SST Config parameter: ${name}`)
  return value
}
