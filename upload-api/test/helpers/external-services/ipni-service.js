import * as dagJSON from '@ipld/dag-json'
import { error, ok } from '@ucanto/server'
import { useIPNIService, BlockAdvertisementPublisherQueue } from '../../../external-services/ipni-service.js'
import { createQueue } from '../../helpers/resources.js'
import { collectQueueMessages } from '../queue.js'
import { RecordNotFound } from '@web3-storage/upload-api/errors'

/** @param {{ sqs: import('@aws-sdk/client-sqs').SQSClient }} config */
export const createTestIPNIService = async ({ sqs }) => {
  const blockAdvertQueueURL = await createQueue(sqs, 'block-advert-publisher')
  const blockAdvertPublisher = new BlockAdvertisementPublisherQueue({
    client: sqs,
    url: blockAdvertQueueURL
  })

  const messages = new Set()
  return Object.assign(
    useIPNIService(blockAdvertPublisher),
    {
      /** @param {import('multiformats').MultihashDigest} digest */
      async query (digest) {
        const collection = await collectQueueMessages(sqs, blockAdvertQueueURL)
        for (const m of collection) {
          /** @type {import('../../../../indexer/types.js').PublishAdvertisementMessage} */
          const raw = dagJSON.parse(m)
          for (const entry of raw.entries) {
            messages.add(dagJSON.stringify(entry))
          }
        }

        return messages.has(dagJSON.stringify(digest.bytes))
          ? ok({})
          : error(new RecordNotFound())
      }
    }
  )
  
}
