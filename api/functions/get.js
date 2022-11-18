import getServiceDid from '../authority.js'

/**
 * AWS HTTP Gateway handler for GET /version
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request 
 */
 export async function version (request) {
  const { NAME: name , VERSION: version } = process.env
  const serviceSigner = await getServiceDid()
  const did = serviceSigner.did()
  const repo = 'https://github.com/web3-storage/upload-api'
  return {
    statusCode: 200,
    headers: {
      'Content-Type': `application/json`
    },
    body: JSON.stringify({ name, version, did, repo })
  }
}

/**
 * AWS HTTP Gateway handler for GET /
 *
 * @param {import('aws-lambda').APIGatewayProxyEventV2} request 
 */
export async function home (request) {
  const { VERSION: version } = process.env
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/plain'
    },
    /* eslint-disable no-useless-escape */
    body: `
           ________                    ._.
  __  _  __\_____  \     __ __ ______  | |
  \ \/ \/ /  _(__  <    |  |  \\____ \ | |
   \     /  /       \   |  |  /|  |_> > \|
    \/\_/  /______  /   |____/ |   __/  __
                  \/           |__|     \/
                         upload-api v${version} 
`
    /* eslint-enable no-useless-escape */
  }
}
