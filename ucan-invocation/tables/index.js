/** @typedef {import('sst/constructs').TableProps} TableProps */

/** @type TableProps */
export const adminMetricsTableProps = {
  fields: {
    name: 'string',        // `total-size`
    value: 'number',         // `101`
  },
  // name must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'name' },
}
