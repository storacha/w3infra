const MB = 1024 * 1024
const GB = 1024 * MB
const TB = 1024 * GB

/** @type {Record<string, import("./api.js").Product>} */
export const productInfo = {
  'did:web:trial.storacha.network': {
    cost: 0,
    overage: 0 / GB,
    included: 100 * MB,
    allowOverages: true,
  },
  'did:web:starter.web3.storage': {
    cost: 0,
    overage: 0.15 / GB,
    included: 5 * GB,
    allowOverages: true,
  },
  'did:web:lite.web3.storage': {
    cost: 10,
    overage: 0.05 / GB,
    included: 100 * GB,
    allowOverages: true,
  },
  'did:web:business.web3.storage': {
    cost: 100,
    overage: 0.03 / GB,
    included: 2 * TB,
    allowOverages: true,
  },
  'did:web:free.web3.storage': {
    cost: 0,
    overage: 0 / GB,
    included: 0,
    allowOverages: true,
  },
  'did:web:starter.staging.web3.storage': {
    cost: 0,
    overage: 0.15 / GB,
    included: 5 * GB,
    allowOverages: true,
  },
  'did:web:lite.staging.web3.storage': {
    cost: 10,
    overage: 0.05 / GB,
    included: 100 * GB,
    allowOverages: true,
  },
  'did:web:business.staging.web3.storage': {
    cost: 100,
    overage: 0.03 / GB,
    included: 2 * TB,
    allowOverages: true,
  },
  'did:web:free.staging.web3.storage': {
    cost: 0,
    overage: 0 / GB,
    included: 0,
    allowOverages: true,
  },
  'did:web:starter.storacha.network': {
    cost: 0,
    overage: 0.15 / GB,
    included: 5 * GB,
    allowOverages: true,
  },
  'did:web:lite.storacha.network': {
    cost: 10,
    overage: 0.05 / GB,
    included: 100 * GB,
    allowOverages: true,
  },
  'did:web:business.storacha.network': {
    cost: 100,
    overage: 0.03 / GB,
    included: 2 * TB,
    allowOverages: true,
  },
  'did:web:free.storacha.network': {
    cost: 0,
    overage: 0 / GB,
    included: 0,
    allowOverages: true,
  },
  'did:web:starter.staging.storacha.network': {
    cost: 0,
    overage: 0.15 / GB,
    included: 5 * GB,
    allowOverages: true,
  },
  'did:web:lite.staging.storacha.network': {
    cost: 10,
    overage: 0.05 / GB,
    included: 100 * GB,
    allowOverages: true,
  },
  'did:web:business.staging.storacha.network': {
    cost: 100,
    overage: 0.03 / GB,
    included: 2 * TB,
    allowOverages: true,
  },
  'did:web:free.staging.storacha.network': {
    cost: 0,
    overage: 0 / GB,
    included: 0,
    allowOverages: true,
  },
}
