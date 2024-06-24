export interface PublishAdvertisementMessage {
  entries: Uint8Array[]
}

export type BlockIndexQueueMessage = [
  location: string,
  Array<[digest: Uint8Array, position: [offset: number, length: number]]>
]
