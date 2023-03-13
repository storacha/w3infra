/** @typedef {import('@serverless-stack/resources').TableProps} TableProps */

/** @type TableProps */
export const adminMetricsTableProps = {
  fields: {
    name: 'string',        // `total-size`
    value: 'number',         // `101`
  },
  // name must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'name' },
}

/** @type TableProps */
export const spaceMetricsTableProps = {
  fields: {
    space: 'string',        // `did:key:space`
    name: 'string',        // `upload/add-count`
    value: 'number',       // `101`
  },
  // space+name must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'space', sortKey: 'name' },
}
