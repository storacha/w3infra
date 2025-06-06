import type { SSTConfig } from 'sst'
import { Tags, RemovalPolicy } from 'aws-cdk-lib'
import path from 'node:path'

import { BillingStack } from './stacks/billing-stack.js'
import { BillingDbStack } from './stacks/billing-db-stack.js'
import { UploadApiStack } from './stacks/upload-api-stack.js'
import { UploadDbStack } from './stacks/upload-db-stack.js'
import { UcanInvocationStack } from './stacks/ucan-invocation-stack.js'
import { BusStack } from './stacks/bus-stack.js'
import { CarparkStack } from './stacks/carpark-stack.js'
import { FilecoinStack } from './stacks/filecoin-stack.js'
import { ReplicatorStack } from './stacks/replicator-stack.js'
import { UcanFirehoseStack } from './stacks/firehose-stack.js'
import { IndexerStack } from './stacks/indexer-stack.js'
import { RoundaboutStack } from './stacks/roundabout-stack.js'
import { PSAStack } from './stacks/psa-stack.js'
import { isPrBuild } from './stacks/config.js'

// Seed.run does not respect the service path and runs the build in the root of
// the repo (despite cd'ing into the service path before build command).
const getServiceConfig = async (): Promise<SSTConfig|undefined> => {
  const servicePath = process.env.SEED_SERVICE_PATH
  if (servicePath) {
    const sstConfig = await import(`./${path.join('.', servicePath, 'sst.config.js')}`)
    return sstConfig.default
  }
}

export default {
  async config(_input) {
    const sstConfig = await getServiceConfig()
    if (sstConfig) return sstConfig.config(_input)
    return {
      name: 'w3infra',
      region: 'us-west-2',
    }
  },
  async stacks(app) {
    const sstConfig = await getServiceConfig()
    if (sstConfig) return sstConfig.stacks(app)
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

    app.stack(PSAStack) // legacy
    app.stack(BusStack) // legacy
    app.stack(UploadDbStack)
    app.stack(RoundaboutStack)
    app.stack(BillingDbStack)
    app.stack(CarparkStack) // legacy
    app.stack(UcanInvocationStack)
    app.stack(BillingStack)
    app.stack(FilecoinStack)
    app.stack(IndexerStack)
    app.stack(UploadApiStack)
    app.stack(ReplicatorStack) // legacy
    app.stack(UcanFirehoseStack)

    // tags let us discover all the aws resource costs incurred by this app
    // see: https://docs.sst.dev/advanced/tagging-resources
    Tags.of(app).add('Project', 'w3infra')
    Tags.of(app).add('Repository', 'https://github.com/storacha/w3infra')
    Tags.of(app).add('Environment', `${app.stage}`)
    Tags.of(app).add('ManagedBy', 'SST')
  },
} satisfies SSTConfig
