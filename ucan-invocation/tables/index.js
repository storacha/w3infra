/** @typedef {import('@serverless-stack/resources').TableProps} TableProps */

/** @type TableProps */
export const w3MetricsTableProps = {
  fields: {
    name: 'string',        // `total-size`
    value: 'number',         // `101`
  },
  // name must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'name' },
}
