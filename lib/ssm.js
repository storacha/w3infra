import { SSMClient, GetParametersCommand } from '@aws-sdk/client-ssm'

/**
 * @typedef {Record<string, string>} SSMParameters
 */

/** @type {SSMParameters | null} */
let cachedParameters = null

/** AWS SSM GetParameters API limit */
const SSM_BATCH_SIZE = 10

/**
 * Load parameters from SSM Parameter Store.
 * Parameters are cached after first load for the lifetime of the Lambda container.
 * Automatically batches requests to comply with AWS SSM's 10 parameter limit.
 * Missing parameters are stored as empty strings in the cache (not an error).
 *
 * @param {string[]} names - Parameter names to load (without the SST prefix)
 * @param {object} [options]
 * @param {string} [options.region] - AWS region (defaults to AWS_REGION env var)
 * @param {string} [options.stage] - SST stage (defaults to SST_STAGE env var)
 * @param {string} [options.app] - SST app name (defaults to SST_APP env var or 'w3infra')
 * @returns {Promise<SSMParameters>}
 */
export async function loadSSMParameters(names, options = {}) {
  if (cachedParameters) {
    return cachedParameters
  }

  const region = options.region ?? process.env.AWS_REGION ?? 'us-west-2'
  const stage = options.stage ?? process.env.SST_STAGE
  const app = options.app ?? process.env.SST_APP ?? 'w3infra'

  if (!stage) {
    throw new Error('SST_STAGE environment variable is required for SSM parameter loading')
  }

  const client = new SSMClient({ region })

  // SST stores Config.Parameters with the path: /sst/{app}/{stage}/Parameter/{name}/value
  const parameterNames = names.map(name => `/sst/${app}/${stage}/Parameter/${name}/value`)

  // Batch requests into groups of 10 (AWS SSM GetParameters limit)
  /** @type {SSMParameters} */
  const parameters = {}

  for (let i = 0; i < parameterNames.length; i += SSM_BATCH_SIZE) {
    const batch = parameterNames.slice(i, i + SSM_BATCH_SIZE)

    const command = new GetParametersCommand({
      Names: batch,
      WithDecryption: true,
    })

    const response = await client.send(command)

    // Note: InvalidParameters are not an error - they just mean the parameter
    // wasn't created (optional parameters with no value set)

    for (const param of response.Parameters ?? []) {
      if (param.Name && param.Value) {
        // Extract the parameter name from the full path
        const match = param.Name.match(/\/Parameter\/([^/]+)\/value$/)
        if (match) {
          parameters[match[1]] = param.Value
        }
      }
    }
  }

  // Initialize missing parameters as empty strings so getSSMParameter returns ''
  for (const name of names) {
    if (!(name in parameters)) {
      parameters[name] = ''
    }
  }

  cachedParameters = parameters
  return parameters
}

/**
 * Get a single SSM parameter value. Must call loadSSMParameters first.
 * Throws if the parameter is not found or is empty.
 *
 * @param {string} name - Parameter name
 * @returns {string}
 */
export function mustGetSSMParameter(name) {
  if (!cachedParameters) {
    throw new Error('SSM parameters not loaded. Call loadSSMParameters first.')
  }
  const value = cachedParameters[name]
  if (!value) {
    throw new Error(`SSM parameter not found or empty: ${name}`)
  }
  return value
}

/**
 * Get a single SSM parameter value, returning empty string if not found.
 * Must call loadSSMParameters first. Use this for optional parameters.
 *
 * @param {string} name - Parameter name
 * @returns {string}
 */
export function getSSMParameter(name) {
  if (!cachedParameters) {
    throw new Error('SSM parameters not loaded. Call loadSSMParameters first.')
  }
  return cachedParameters[name] ?? ''
}

/**
 * Clear the cached parameters. Useful for testing.
 */
export function clearSSMCache() {
  cachedParameters = null
}
