import { Tags } from 'aws-cdk-lib'

import { ApiStack } from './api-stack.js'

/**
 * @param {import('@serverless-stack/resources').App} app
 */
export default function (app) {
  app.setDefaultFunctionProps({
    runtime: 'nodejs16.x',
    srcPath: 'services',
    bundle: {
      format: 'esm',
    },
  })
  app.stack(ApiStack)

  // tags let us discover all the aws resource costs incurred by this app
  // see: https://docs.sst.dev/advanced/tagging-resources
  Tags.of(app).add('Project', 'w3up-api')
  Tags.of(app).add('Repository', 'https://github.com/web3-storage/w3up-api')
  Tags.of(app).add('Environment', `${app.stage}`)
  Tags.of(app).add('ManagedBy', 'SST')
}
