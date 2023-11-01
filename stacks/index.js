import { Tags, RemovalPolicy } from 'aws-cdk-lib'
import { BillingStack } from './billing-stack.js'
import { BillingDbStack } from './billing-db-stack.js'
import { UploadApiStack } from './upload-api-stack.js'
import { UploadDbStack } from './upload-db-stack.js'
import { UcanInvocationStack } from './ucan-invocation-stack.js'
import { BusStack } from './bus-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { FilecoinStack } from './filecoin-stack.js'
import { SatnavStack } from './satnav-stack.js'
import { ReplicatorStack } from './replicator-stack.js'
import { UcanFirehoseStack } from './firehose-stack.js'
import { RoundaboutStack } from './roundabout-stack.js'
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
    environment: {
      NODE_OPTIONS: "--enable-source-maps --experimental-fetch",
    },
    bundle: {
      format: 'esm',
      sourcemap: true,
    },
  })
  app.stack(BusStack)
  app.stack(UploadDbStack)
  app.stack(BillingDbStack)
  app.stack(CarparkStack)
  app.stack(UcanInvocationStack)
  app.stack(BillingStack)
  app.stack(FilecoinStack)
  app.stack(SatnavStack)
  app.stack(UploadApiStack)
  app.stack(ReplicatorStack)
  app.stack(UcanFirehoseStack)
  app.stack(RoundaboutStack)

  // tags let us discover all the aws resource costs incurred by this app
  // see: https://docs.sst.dev/advanced/tagging-resources
  Tags.of(app).add('Project', 'w3infra')
  Tags.of(app).add('Repository', 'https://github.com/web3-storage/w3infra')
  Tags.of(app).add('Environment', `${app.stage}`)
  Tags.of(app).add('ManagedBy', 'SST')
}
