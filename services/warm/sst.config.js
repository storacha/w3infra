import { Tags, RemovalPolicy } from 'aws-cdk-lib'
import { BillingStack } from '../../stacks/billing-stack.js'
import { BillingDbStack } from '../../stacks/billing-db-stack.js'
import { UploadApiStack } from '../../stacks/upload-api-stack.js'
import { UploadDbStack } from '../../stacks/upload-db-stack.js'
import { UcanInvocationStack } from '../../stacks/ucan-invocation-stack.js'
import { BusStack } from '../../stacks/bus-stack.js'
import { CarparkStack } from '../../stacks/carpark-stack.js'
import { FilecoinStack } from '../../stacks/filecoin-stack.js'
import { UcanFirehoseStack } from '../../stacks/firehose-stack.js'
import { RoundaboutStack } from '../../stacks/roundabout-stack.js'
import { isPrBuild } from '../../stacks/config.js'

/** @type {import('sst').SSTConfig} */
export default {
  config(_input) {
    return {
      name: 'warm-upload-api',
      region: 'us-west-2',
    }
  },
  stacks(app) {
    if (isPrBuild(app.stage)) {
      // destroy buckets and tables for PR builds
      app.setDefaultRemovalPolicy(RemovalPolicy.DESTROY)
    }

    app.setDefaultFunctionProps({
      runtime: 'nodejs20.x',
      architecture: 'arm_64',
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
      },
      nodejs: {
        format: 'esm',
        sourcemap: true,
      },
      tracing: app.stage === 'staging' || isPrBuild(app.stage)
        ? 'active'
        : 'disabled'
    })

    // IPNI publishing is force disabled as the indexer stack is not included
    if (process.env.DISABLE_IPNI_PUBLISHING !== 'true') {
      throw new Error(`IPNI publishing is required to be disabled - set DISABLE_IPNI_PUBLISHING='true'`)
    }

    app.stack(BusStack) // legacy
    app.stack(UploadDbStack)
    app.stack(RoundaboutStack)
    app.stack(BillingDbStack)
    app.stack(CarparkStack) // legacy
    app.stack(UcanInvocationStack)
    app.stack(BillingStack)
    app.stack(FilecoinStack)
    app.stack(UploadApiStack)
    app.stack(UcanFirehoseStack)

    // tags let us discover all the aws resource costs incurred by this app
    // see: https://docs.sst.dev/advanced/tagging-resources
    Tags.of(app).add('Project', 'warm-upload-api')
    Tags.of(app).add('Repository', 'https://github.com/storacha/w3infra')
    Tags.of(app).add('Environment', app.stage)
    Tags.of(app).add('ManagedBy', 'SST')
  },
}
