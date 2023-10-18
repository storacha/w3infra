import { Table } from '@serverless-stack/resources'
import {
  customerTableProps,
  spaceSnapshotTableProps,
  spaceDiffTableProps,
  usageTableProps
} from '../billing/tables/index.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export const BillingDbStack = ({ stack }) => {
  const customerTable = new Table(stack, 'customer', customerTableProps)
  const spaceSnapshotTable = new Table(stack, 'space-snapshot', spaceSnapshotTableProps)
  const spaceDiffTable = new Table(stack, 'space-diff', spaceDiffTableProps)
  const usageTable = new Table(stack, 'usage', usageTableProps)
  return { customerTable, spaceSnapshotTable, spaceDiffTable, usageTable }
}
