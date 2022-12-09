import { Table } from '@serverless-stack/resources'

import { storeTableProps, uploadTableProps } from '../upload-api/tables/index.js'
import { getConfig, setupSentry } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function UploadDbStack({ stack, app }) {
  // @ts-expect-error "prod" | "dev" | "staging" only allowed for stage
  const stackConfig = getConfig(stack.stage)

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  /**
   * This table takes a stored CAR and makes an entry in the store table
   * to associate the uploaders DID with a payload CID.
   * You can also optionally indicate an application DID and origin.
   *
   * This is used by the store/* service capabilities.
   */
   const storeTable = new Table(stack, 'store', {
    ...storeTableProps,
    ...stackConfig.tableConfig,
  })

  /**
   * This table maps stored CAR files (shards) to an upload root cid (dataCID).
   * These are stored as individual rows, from dataCID to carCID:
   * 
   * upload -> {root, shards} -> maps to [[root,shard1], ...[root, shardN]]
   * 
   * This is used by the upload/* capabilities.
   */
   const uploadTable = new Table(stack, 'upload', {
    ...uploadTableProps,
    ...stackConfig.tableConfig,
  })

  return {
    storeTable,
    uploadTable
  }
}
