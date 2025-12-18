/**
 * Archive table for compacted space diffs.
 * Same structure as space-diff table plus summationDiffSk field.
 *
 * @type {import('sst/constructs').TableProps}
 */
export const spaceDiffArchiveTableProps = {
  fields: {
    pk: 'string',
    sk: 'string',
    space: 'string',
    provider: 'string',
    subscription: 'string',
    cause: 'string',
    delta: 'number',
    receiptAt: 'string',
    insertedAt: 'string',
    summationDiffSk: 'string'
  },
  primaryIndex: { partitionKey: 'pk', sortKey: 'sk' }
}
