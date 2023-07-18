import * as DidMailto from '@web3-storage/did-mailto'
import { exec as childProcessExec } from 'child_process'

/**
 * 
 * @param {string} command 
 * @returns 
 */
const exec = async (command) => {
  return new Promise((resolve, reject) => {
    childProcessExec(command, (error, stdout, stderr) => {
      if (error !== null) reject(error)
      if (stderr !== '') reject(stderr)
      else resolve(stdout)
    })
  })
}

async function loadD1ProvisionsEmails () {
  const {
    STAGE,
  } = getEnv()

  const dbName = (STAGE === 'prod') ? 'access' : 'access-staging'
  const emails = JSON.parse(await exec(`wrangler d1 execute ${dbName} --command 'SELECT * from provisions' --json`))[0].results.map(/** @param {{sponsor: `did:mailto:${string}:${string}`}} provision */(provision) => {
    return DidMailto.toEmail(provision.sponsor)
  })
  return [...new Set(emails)]
}

/**
 * Get Env validating it is set.
 */
function getEnv () {
  return {
    STAGE: mustGetEnv('STAGE'),
  }
}

/**
 * 
 * @param {string} name 
 * @returns {string}
 */
function mustGetEnv (name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing env var: ${name}`)
  }

  return value
}

export async function printD1ProvisionsEmails () {
  (await loadD1ProvisionsEmails()).map(e => console.log(e))
}