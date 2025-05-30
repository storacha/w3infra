/** A record that is of suitable type to be put in DynamoDB. */
export type StoreRecord = Record<string, string|number>

export type InferStoreRecord<T> = {
  [Property in keyof T]: T[Property] extends Number ? T[Property] : string
}

export interface PublishAdvertisementMessage {
  entries: Uint8Array[]
}

export type BlockIndexQueueMessage = [
  location: string,
  slices: Array<[digest: Uint8Array, position: [offset: number, length: number]]>
]
