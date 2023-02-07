export const REPLICATOR_EVENT_BRIDGE_SOURCE_EVENT = 'w3infra-replicator'

/**
 * @typedef {object} EventBridgeDetail
 * @property {string} key
 * @property {string} url
 */

/**
 * @param {EventBridgeDetail} detail
 * @param {import('@aws-sdk/client-eventbridge').EventBridge} eventBridge
 * @param {string} eventBusName
 */
 export async function notifyBus(detail, eventBridge, eventBusName) {
  await eventBridge.putEvents({
    Entries: [{
      EventBusName: eventBusName,
      Source: REPLICATOR_EVENT_BRIDGE_SOURCE_EVENT,
      DetailType: 'file_replicated',
      Detail: JSON.stringify(detail)
    }]
  })
}
