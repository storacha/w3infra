import getServiceDid from '../authority.js'

/**
 * AWS HTTP Gateway handler for GET /version
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request 
 */
 export async function version (request) {
  const { NAME: name , VERSION: version, COMMIT: commit, BRANCH: branch, STAGE: env } = process.env
  const serviceSigner = await getServiceDid()
  const did = serviceSigner.did()
  const repo = 'https://github.com/web3-storage/upload-api'
  return {
    statusCode: 200,
    headers: {
      'Content-Type': `application/json`
    },
    body: JSON.stringify({ name, version, did, repo, branch, commit, env })
  }
}

/**
 * AWS HTTP Gateway handler for GET /
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request 
 */
export async function home (request) {
  const { VERSION: version, STAGE: stage } = process.env
  const serviceSigner = await getServiceDid()
  const did = serviceSigner.did()
  const repo = 'https://github.com/web3-storage/upload-api'
  const env = stage === 'prod' ? '' : `(${stage})`
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/plain'
    },
    body: `⁂ upload-api v${version} ${env}\n- ${repo}\n- ${did}\n`
  }
}
