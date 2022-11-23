/**
 * Convert SST Table spec to DynamoDB CreateTable command config
 *
 * @param {{fields: Record<string,string>, primaryIndex: { partitionKey: string, sortKey: string}}} config
 */
export function dynamoDBTableConfig ({ fields, primaryIndex }) {
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

export const storeTableSchema = {
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

export const uploadTableSchema = {
  fields: {
    uploaderDID: 'string',
    dataCID: 'string', // root CID
    carCID: 'string', // shard CID
    sk: 'string', // 'dataCID#carCID' used to guarantee uniqueness
    uploadedAt: 'string',
  },
  primaryIndex: { partitionKey: 'uploaderDID', sortKey: 'sk' },
}
