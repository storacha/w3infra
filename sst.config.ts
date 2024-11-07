import type { SSTConfig } from 'sst'
import { Tags, RemovalPolicy } from 'aws-cdk-lib'

import { BillingStack } from './stacks/billing-stack.js'
import { BillingDbStack } from './stacks/billing-db-stack.js'
import { UploadApiStack } from './stacks/upload-api-stack.js'
import { UploadDbStack } from './stacks/upload-db-stack.js'
import { UcanInvocationStack } from './stacks/ucan-invocation-stack.js'
import { FilecoinStack } from './stacks/filecoin-stack.js'
import { UcanFirehoseStack } from './stacks/firehose-stack.js'
// import { RoundaboutStack } from './stacks/roundabout-stack.js'
import { isPrBuild } from './stacks/config.js'

export default {
  config(_input) {
    return {
      name: 'upload-service-infra',
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

    app.stack(UploadDbStack)
    // FIXME: needs update to work with indexing service
    // app.stack(RoundaboutStack)
    app.stack(BillingDbStack)
    app.stack(UcanInvocationStack)
    app.stack(BillingStack)
    app.stack(FilecoinStack)
    app.stack(UploadApiStack)
    app.stack(UcanFirehoseStack)

    // tags let us discover all the aws resource costs incurred by this app
    // see: https://docs.sst.dev/advanced/tagging-resources
    Tags.of(app).add('Project', 'upload-service')
    Tags.of(app).add('Repository', 'https://github.com/storacha/upload-service-infra')
    Tags.of(app).add('Environment', `${app.stage}`)
    Tags.of(app).add('ManagedBy', 'SST')
  },
} satisfies SSTConfig
