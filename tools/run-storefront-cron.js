/**
 * Run the storefront cron job.
 *
 * Required env:
 * STAGE - prod or staging
 * PRIVATE_KEY - w3up service private key
 */
import * as DID from '@ipld/dag-ucan/did'
import * as storefrontEvents from '@web3-storage/filecoin-api/storefront/events'
import dotenv from 'dotenv'
import { getServiceSigner } from '../filecoin/service.js'
import { createPieceTable } from '../filecoin/store/piece.js'
import { createReceiptStore } from '../filecoin/store/receipt.js'
import { createTaskStore } from '../filecoin/store/task.js'
import { getAggregatorServiceDID, getInvocationBucketName, getPieceTableName, getRegion, getServiceDID, getStage, getWorkflowBucketName } from './lib.js'
import { mustGetEnv } from '../lib/env.js'

dotenv.config({ path: ['.env', '../.env'] })

export const runStorefrontCron = async () => {
  const stage = getStage()
  const region = getRegion(stage)

  const pieceTableName = getPieceTableName(stage)
  const pieceStore = createPieceTable(region, pieceTableName)
  const invocationBucketName = getInvocationBucketName(stage)
  const workflowBucketName = getWorkflowBucketName(stage)
  const receiptStore = createReceiptStore(region, invocationBucketName, workflowBucketName)
  const taskStore = createTaskStore(region, invocationBucketName, workflowBucketName)

  const PRIVATE_KEY = mustGetEnv('PRIVATE_KEY')
  const servicePrincipal = DID.parse(getServiceDID(stage))
  const serviceSigner = getServiceSigner({ privateKey: PRIVATE_KEY }).withDID(servicePrincipal.did())

  const aggregatorServicePrincipal = DID.parse(getAggregatorServiceDID(stage))

  const res = await storefrontEvents.handleCronTick({
    id: serviceSigner,
    pieceStore,
    receiptStore,
    taskStore,
    aggregatorId: aggregatorServicePrincipal
  })

  if (res.error) {
    throw new Error('running storefront cron', { cause: res.error })
  }

  console.log(res.ok)
  console.log('Done!')
}
