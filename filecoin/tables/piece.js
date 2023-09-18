import {
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb'
import { marshall } from '@aws-sdk/util-dynamodb'

import { DatabaseOperationFailed } from '../errors.js'

/**
 * Abstraction layer to handle operations on Piece Table.
 *
 * @param {string} region
 * @param {string} tableName
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @returns {import('../types').PieceTable}
 */
export function createPieceTable (region, tableName, options = {}) {
  const dynamoDb = new DynamoDBClient({
    region,
    endpoint: options.endpoint
  })

  return usePieceTable(dynamoDb, tableName)
}

/**
 * @param {DynamoDBClient} dynamoDb
 * @param {string} tableName
 * @returns {import('../types').PieceTable}
 */
export function usePieceTable(dynamoDb, tableName) {
  return {
    /**
     * Bind a link CID to Piece CID.
     *
     * @param {import('../types').PieceInsertInput} input
     */
    insert: async (input) => {
      const insertedAt = new Date().toISOString()

      const cmd = new PutItemCommand({
        TableName: tableName,
        Item: marshall({
          link: input.link.toString(),
          piece: input.piece.toString(),
          insertedAt
        }),
      })

      try {
        await dynamoDb.send(cmd)
      } catch (/** @type {any} */ error) {
        return {
          error: new DatabaseOperationFailed(`failed put to dynamo piece table, link: ${input.link}, piece: ${input.piece}`, { cause: error })
        }
      }

      return {
        ok: {}
      }
    },
  }
}
