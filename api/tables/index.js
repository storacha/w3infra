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
export const StoreTablePropsv0 = {
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
export const uploadTablePropsV0 = {
  fields: {
    uploaderDID: 'string',
    dataCID: 'string', // root CID
    carCID: 'string', // shard CID
    sk: 'string', // 'dataCID#carCID' used to guarantee uniqueness
    uploadedAt: 'string',
  },
  primaryIndex: { partitionKey: 'uploaderDID', sortKey: 'sk' },
}

/** @type TableProps */
export const storeTableProps = {
  fields: {
    space: 'string',        // `did:key:space`
    car: 'string',          // `bagy...1`
    size: 'number',         // `101`
    origin: 'string',       // `bagy...0` (prev CAR CID. optional)
    agent: 'string',        // `did:key:agent` (issuer of ucan)
    ucan: 'string',         // `baf...ucan` (CID of invcation UCAN)
    insertedAt: 'string',   // `2022-12-24T...`
  },
  // space + car must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'space', sortKey: 'car' },
}

/** @type TableProps */
export const uploadTableProps = {
  fields: {
    space: 'string',        // `did:key:space`
    sk: 'string',           // `root#shard` + space must be unique for dynamo index constraint
    root: 'string',         // `baf...x`
    shard: 'string',        // `bagy...1
    agent: 'string',        // `did:key:agent` (issuer of ucan)
    ucan: 'string',         // `baf...ucan` (CID of invcation UCAN)
    insertedAt: 'string',   // `2022-12-24T...`
  },
  // space + sk must be unique to satisfy index constraint
  primaryIndex: { partitionKey: 'space', sortKey: 'sk' },
}
