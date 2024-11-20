import { mustGetEnv } from '../lib/env.js'

/** @returns {'staging'|'prod'} */
export function getStage () {
  const stage = mustGetEnv('STAGE')
  if (stage !== 'prod' && stage !== 'staging') {
    throw new Error(`invalid environment name: ${stage}`)
  }
  return stage
}

/** @param {'staging'|'prod'} stage */
export const getRegion = stage =>
  stage === 'staging' ? 'us-east-2' : 'us-west-2'

/** @param {'staging'|'prod'} stage */
export const getPieceTableName = stage =>
  stage === 'staging' ? 'staging-w3infra-piece-v2' : 'prod-w3infra-piece-v2'

/** @param {'staging'|'prod'} stage */
export const getInclusionTableName = stage =>
  stage === 'staging'
    ? 'staging-w3filecoin-aggregator-inclusion-store'
    : 'prod-w3filecoin-aggregator-inclusion-store'

/** @param {'staging'|'prod'} stage */
export const getAggregatorPieceTableName = stage =>
  stage === 'staging'
    ? 'staging-w3filecoin-aggregator-piece-store'
    : 'prod-w3filecoin-aggregator-piece-store'

/** @param {'staging'|'prod'} stage */
export const getInvocationBucketName = stage =>
  stage === 'staging' ? 'invocation-store-staging-0' : 'invocation-store-prod-0'

/** @param {'staging'|'prod'} stage */
export const getWorkflowBucketName = stage =>
  stage === 'staging' ? 'workflow-store-staging-0' : 'workflow-store-prod-0'

/** @param {'staging'|'prod'} stage */
export const getServiceDID = stage =>
  stage === 'staging' ? 'did:web:staging.web3.storage' : 'did:web:web3.storage'

/** @param {'staging'|'prod'} stage */
export const getAggregatorServiceDID = stage =>
  stage === 'staging' ? 'did:web:staging.web3.storage' : 'did:web:web3.storage'
