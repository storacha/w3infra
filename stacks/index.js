import { Tags, RemovalPolicy } from 'aws-cdk-lib'

import { UploadApiStack } from './upload-api-stack.js'
import { UploadDbStack } from './upload-db-stack.js'
import { UcanInvocationStack } from './ucan-invocation-stack.js'
import { BusStack } from './bus-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { SatnavStack } from './satnav-stack.js'
import { isPrBuild } from './config.js'

/**
 * @param {import('@serverless-stack/resources').App} app
 */
export default function (app) {
  if (isPrBuild(app.stage)) {
    // destroy buckets and tables for PR builds
    app.setDefaultRemovalPolicy(RemovalPolicy.DESTROY)
  }
  app.setDefaultFunctionProps({
    runtime: 'nodejs16.x',
    bundle: {
      format: 'esm',
    },
  })
  app.stack(BusStack)
  app.stack(UcanInvocationStack)
  app.stack(CarparkStack)
  app.stack(UploadDbStack)
  app.stack(SatnavStack)
  app.stack(UploadApiStack)

  // tags let us discover all the aws resource costs incurred by this app
  // see: https://docs.sst.dev/advanced/tagging-resources
  Tags.of(app).add('Project', 'w3infra')
  Tags.of(app).add('Repository', 'https://github.com/web3-storage/w3infra')
  Tags.of(app).add('Environment', `${app.stage}`)
  Tags.of(app).add('ManagedBy', 'SST')
}
