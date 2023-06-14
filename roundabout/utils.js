
/**
 * Get Env validating it is set.
 */
export function getEnv() {
  return {
    BUCKET_ENDPOINT: mustGetEnv('BUCKET_ENDPOINT'),
    BUCKET_REGION: mustGetEnv('BUCKET_REGION'),
    BUCKET_ACCESS_KEY_ID: mustGetEnv('BUCKET_ACCESS_KEY_ID'),
    BUCKET_SECRET_ACCESS_KEY: mustGetEnv('BUCKET_SECRET_ACCESS_KEY'),
    BUCKET_BUCKET_NAME: mustGetEnv('BUCKET_BUCKET_NAME')
  }
}

/**
 * 
 * @param {string} name 
 * @returns {string}
 */
function mustGetEnv (name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}
