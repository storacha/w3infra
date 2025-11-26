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
  "prod": {
    "did:web:starter.storacha.network": [
      // flat fee
      { "price": "price_1SUtuZF6A5ufQX5vLdJgK8gW", "quantity": 1 },
      // storage overage
      { "price": "price_1SUtv3F6A5ufQX5vTZHG0J7s" },
      // egress overage
      { "price": "price_1SUtv6F6A5ufQX5v4w4JmhoU" }
    ],
    "did:web:lite.storacha.network": [
      // flat fee
      { "price": "price_1SUtvAF6A5ufQX5vM1Dc3Kpl", "quantity": 1 },
      // storage overage
      { "price": "price_1SUtvEF6A5ufQX5vI9ReH4wb" },
      // egress overage
      { "price": "price_1SUtvIF6A5ufQX5v2AKQcSKf" }
    ],
    "did:web:business.storacha.network": [
      // flat fee
      { "price": "price_1SUtvLF6A5ufQX5vjHMdUcHh", "quantity": 1 },
      // storage overage
      { "price": "price_1SUtvOF6A5ufQX5vO9WL1jF7" },
      // egress overage
      { "price": "price_1SUtvSF6A5ufQX5vaTkB55xm" }
    ]
  }
}

export const PRICES_TO_PLANS_MAPPING = Object.entries(PLANS_TO_LINE_ITEMS_MAPPING).reduce((m, [env, v]) => {
  m[env] = Object.entries(v).reduce((n, [plan, lineItems]) => {
    for (const item of lineItems) {
      if (item.price) {
        n[item.price] = plan
      }
    }
    return n
  }, /** @type { Record<string, string> } */({}))
  return m
}, /** @type { Record<string, Record<string, string>> } */({}))

/**
 * @type {Record<string, Record<string, string?>>}
 */
export const FREE_TRIAL_COUPONS = {
  "staging": {
    // no coupons for starter, it has no subscription fee anyway
    "did:web:starter.storacha.network": null,
    "did:web:lite.storacha.network":  "ezGFDDGl",
    "did:web:business.storacha.network": "9lb527n3"
  },
  
  "prod": {
    "did:web:starter.storacha.network": null,
    "did:web:lite.storacha.network":  "HUzxFTsy",
    "did:web:business.storacha.network": "HaWdvmvf"
  }
}