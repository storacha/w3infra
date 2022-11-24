/** @typedef {import('@aws-sdk/client-dynamodb').CreateTableCommandInput} CreateTableCommandInput */
/** @typedef {import('@serverless-stack/resources').TableProps} TableProps */

/**
 * Convert SST TableProps to DynamoDB `CreateTableCommandInput` config
 *
 * @param {TableProps} props
 * @returns {Pick<CreateTableCommandInput, 'AttributeDefinitions' | 'KeySchema'>}
 */
export function dynamoDBTableConfig ({ fields, primaryIndex }) {
  if (!primaryIndex || !fields) throw new Error('Expected primaryIndex and fields on TableProps')
  const attributes = Object.values(primaryIndex)
  const AttributeDefinitions = Object.entries(fields)
    .filter(([k]) => attributes.includes(k)) // 'The number of attributes in key schema must match the number of attributes defined in attribute definitions'
    .map(([k, v]) => ({
      AttributeName: k,
      AttributeType: v[0].toUpperCase()
    }))
  const KeySchema = [
    { AttributeName: primaryIndex.partitionKey, KeyType: 'HASH' }
  ]
  if (primaryIndex.sortKey) {
    KeySchema.push(
      { AttributeName: primaryIndex.sortKey, KeyType: 'RANGE' }
    )
  }
  return {
    AttributeDefinitions,
    KeySchema
  }
}

/** @type TableProps */
export const storeTableProps = {
  fields: {
    uploaderDID: 'string',
    payloadCID: 'string',
    applicationDID: 'string',
    origin: 'string',
    size: 'number',
    proof: 'string',
    uploadedAt: 'string',
  },
  primaryIndex: { partitionKey: 'uploaderDID', sortKey: 'payloadCID' },
}

/** @type TableProps */
export const uploadTableProps = {
  fields: {
    uploaderDID: 'string',
    dataCID: 'string', // root CID
    carCID: 'string', // shard CID
    sk: 'string', // 'dataCID#carCID' used to guarantee uniqueness
    uploadedAt: 'string',
  },
  primaryIndex: { partitionKey: 'uploaderDID', sortKey: 'sk' },
}
