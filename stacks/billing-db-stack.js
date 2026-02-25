import { Table, Config } from 'sst/constructs'
import { customerTableProps } from '../billing/tables/customer.js'
import { spaceDiffTableProps } from '../billing/tables/space-diff.js'
import { spaceDiffArchiveTableProps } from '../billing/tables/space-diff-archive.js'
import { spaceSnapshotTableProps } from '../billing/tables/space-snapshot.js'
import { usageTableProps } from '../billing/tables/usage.js'
import { egressTrafficTableProps } from '../billing/tables/egress-traffic.js'
import { egressTrafficMonthlyTableProps } from '../billing/tables/egress-traffic-monthly.js'

/**
 * @param {import('sst/constructs').StackContext} properties
 */
export const BillingDbStack = ({ stack }) => {
  const customerTable = new Table(stack, 'customer', customerTableProps)
  const spaceSnapshotTable = new Table(stack, 'space-snapshot', spaceSnapshotTableProps)
  const spaceDiffTable = new Table(stack, 'space-diff', spaceDiffTableProps)
  const spaceDiffArchiveTable = new Table(stack, 'space-diff-archive', spaceDiffArchiveTableProps)
  const usageTable = new Table(stack, 'usage', {
    ...usageTableProps,
    stream: 'new_image'
  })
  const egressTrafficTable = new Table(stack, 'egress-traffic-events', egressTrafficTableProps)
  const egressTrafficMonthlyTable = new Table(stack, 'egress-traffic-monthly', egressTrafficMonthlyTableProps)

  stack.addOutputs({
    customerTableName: customerTable.tableName,
    spaceSnapshotTableName: spaceSnapshotTable.tableName,
    spaceDiffTableName: spaceDiffTable.tableName,
    spaceDiffArchiveTableName: spaceDiffArchiveTable.tableName,
    usageTable: usageTable.tableName,
    egressTrafficTableName: egressTrafficTable.tableName,
    egressTrafficMonthlyTableName: egressTrafficMonthlyTable.tableName
  })

  const stripeSecretKey = new Config.Secret(stack, 'STRIPE_SECRET_KEY')

  return { customerTable, spaceSnapshotTable, spaceDiffTable, spaceDiffArchiveTable, usageTable, egressTrafficTable, egressTrafficMonthlyTable, stripeSecretKey }
}
