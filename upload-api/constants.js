import {
  add as storeAdd,
  remove as storeRemove
} from '@storacha/capabilities/store'
import {
  add as uploadAdd,
  remove as uploadRemove
} from '@storacha/capabilities/upload'
import {
  add as blobAdd,
  remove as blobRemove
} from '@storacha/capabilities/space/blob'

// UCAN protocol
export const BLOB_ADD = blobAdd.can
export const BLOB_REMOVE = blobRemove.can
/** @deprecated */
export const STORE_ADD = storeAdd.can
/** @deprecated */
export const STORE_REMOVE = storeRemove.can
export const UPLOAD_ADD = uploadAdd.can
export const UPLOAD_REMOVE = uploadRemove.can

// Admin Metrics
export const METRICS_NAMES = {
  UPLOAD_ADD_TOTAL: `${UPLOAD_ADD}-total`,
  UPLOAD_REMOVE_TOTAL: `${UPLOAD_REMOVE}-total`,
  BLOB_ADD_TOTAL: `${BLOB_ADD}-total`,
  BLOB_ADD_SIZE_TOTAL: `${BLOB_ADD}-size-total`,
  BLOB_REMOVE_TOTAL: `${BLOB_REMOVE}-total`,
  BLOB_REMOVE_SIZE_TOTAL: `${BLOB_REMOVE}-size-total`,
  /** @deprecated */
  STORE_ADD_TOTAL: `${STORE_ADD}-total`,
  /** @deprecated */
  STORE_ADD_SIZE_TOTAL: `${STORE_ADD}-size-total`,
  /** @deprecated */
  STORE_REMOVE_TOTAL: `${STORE_REMOVE}-total`,
  /** @deprecated */
  STORE_REMOVE_SIZE_TOTAL: `${STORE_REMOVE}-size-total`,
}

// Space Metrics
export const SPACE_METRICS_NAMES = {
  UPLOAD_ADD_TOTAL: `${UPLOAD_ADD}-total`,
  UPLOAD_REMOVE_TOTAL: `${UPLOAD_REMOVE}-total`,
  BLOB_ADD_TOTAL: `${BLOB_ADD}-total`,
  BLOB_ADD_SIZE_TOTAL: `${BLOB_ADD}-size-total`,
  BLOB_REMOVE_TOTAL: `${BLOB_REMOVE}-total`,
  BLOB_REMOVE_SIZE_TOTAL: `${BLOB_REMOVE}-size-total`,
  /** @deprecated */
  STORE_ADD_TOTAL: `${STORE_ADD}-total`,
  /** @deprecated */
  STORE_ADD_SIZE_TOTAL: `${STORE_ADD}-size-total`,
  /** @deprecated */
  STORE_REMOVE_TOTAL: `${STORE_REMOVE}-total`,
  /** @deprecated */
  STORE_REMOVE_SIZE_TOTAL: `${STORE_REMOVE}-size-total`,
}

/**
 * @type {Record<string, import('./types.js').PlansToLineItems>}
 */
export const PLANS_TO_LINE_ITEMS_MAPPING = {
  "staging": {
    "did:web:starter.storacha.network": [
      { "price": "price_1SJMcVF6A5ufQX5voRJSNUWT", "quantity": 1 },
      { "price": "price_1SJMfPF6A5ufQX5vdfInsdls" },
      { "price": "price_1SJMgMF6A5ufQX5vVX927Uvx" }
    ],
    "did:web:lite.storacha.network": [
      { "price": "price_1SKRC5F6A5ufQX5vRpsfsnAV", "quantity": 1 },
      { "price": "price_1SKRFHF6A5ufQX5vE4YQ0dk2" },
      { "price": "price_1SKRGrF6A5ufQX5v2XXj8FwQ" }
    ],
    "did:web:business.storacha.network": [
      { "price": "price_1SKRJSF6A5ufQX5vXZrDTvW8", "quantity": 1 },
      { "price": "price_1SKRRkF6A5ufQX5vLlfGHtG1" },
      { "price": "price_1SKRWCF6A5ufQX5vlkNUeTBz" }
    ]
  },
  // TODO: replace with real production values
  "production": {
    "did:web:starter.storacha.network": [
      { "price": "price_1SJMcVF6A5ufQX5voRJSNUWT", "quantity": 1 },
      { "price": "price_1SJMfPF6A5ufQX5vdfInsdls" },
      { "price": "price_1SJMgMF6A5ufQX5vVX927Uvx" }
    ],
    "did:web:lite.storacha.network": [
      { "price": "price_1SKRC5F6A5ufQX5vRpsfsnAV", "quantity": 1 },
      { "price": "price_1SKRFHF6A5ufQX5vE4YQ0dk2" },
      { "price": "price_1SKRGrF6A5ufQX5v2XXj8FwQ" }
    ],
    "did:web:business.storacha.network": [
      { "price": "price_1SKRJSF6A5ufQX5vXZrDTvW8", "quantity": 1 },
      { "price": "price_1SKRRkF6A5ufQX5vLlfGHtG1" },
      { "price": "price_1SKRWCF6A5ufQX5vlkNUeTBz" }
    ]
  }
}
