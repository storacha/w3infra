import { Table } from '@serverless-stack/resources'
import {
  customerTableProps,
  spaceSizeSnapshotTableProps,
  spaceSizeDiffTableProps
} from '../billing/tables/index.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export const BillingDbStack = ({ stack }) => {
  const customerTable = new Table(stack, 'customer', customerTableProps)
  const spaceSizeSnapshotTable = new Table(stack, 'space-size-snapshot', spaceSizeSnapshotTableProps)
  const spaceSizeDiffTable = new Table(stack, 'space-size-diff', spaceSizeDiffTableProps)
  return { customerTable, spaceSizeSnapshotTable, spaceSizeDiffTable }
}
