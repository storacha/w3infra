import { Table } from '@serverless-stack/resources'
import { customerTableProps } from '../billing/tables/customer.js'
import { spaceDiffTableProps } from '../billing/tables/space-diff.js'
import { spaceSnapshotTableProps } from '../billing/tables/space-snapshot.js'
import { usageTableProps } from '../billing/tables/usage.js'

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
