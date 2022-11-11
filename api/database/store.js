import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

/**
 * @typedef {object} StoreItem
 * @property {string} uploaderDID
 * @property {string} payloadCID
 * @property {string} applicationDID
 * @property {string} origin
 * @property {number} size
 * @property {string} proof
 * @property {string} uploadedAt
 */

/**
 * Abstraction layer to handle operations on Store Table.
 */
export class StoreTable {
  /**
   * @param {string} region
   * @param {string} tableName
   * @param {object} [options]
   * @param {string} [options.endpoint]
   */
  constructor (region, tableName, options = {}) {
    this.dynamoDb = new DynamoDBClient({
      region,
      endpoint: options.endpoint
    })
    this.tableName = tableName
  }

  /**
   * Check if the given link CID is bound to the uploader account
   *
   * @param {string} uploaderDID
   * @param {string} payloadCID
   */
  async exists (uploaderDID, payloadCID) {
    const params = {
      TableName: this.tableName,
      Key: marshall({
        uploaderDID: uploaderDID.toString(),
        payloadCID: payloadCID.toString(),
      }),
      AttributesToGet: ['uploaderDID'],
    }

    try {
      const response = await this.dynamoDb.send(new GetItemCommand(params))
      return response?.Item !== undefined
    } catch {
      return false
    }
  }

  /**
   * Bind a link CID to an account
   *
   * @param {object} data
   * @param {string} data.accountDID
   * @param {string} data.link
   * @param {object} data.proof
   * @param {string} data.origin
   * @param {number} data.size
   * @returns {Promise<StoreItem>}
   */
  async insert({ accountDID, link, proof, origin, size = 0 }) {
    const item = {
      uploaderDID: accountDID?.toString(),
      payloadCID: link?.toString(),
      applicationDID: '',
      origin: origin?.toString() || '',
      size,
      proof: proof?.toString(),
      uploadedAt: new Date().toISOString(),
    }

    const params = {
      TableName: this.tableName,
      Item: marshall(item),
    }

    await this.dynamoDb.send(new PutItemCommand(params))

    return item
  }
}
