

export const PROD_STARTER_PRICE_ID = 'price_1OCGzeF6A5ufQX5v1EDCK765' // $0 + $0.15 per GB
export const PROD_LITE_PRICE_ID = 'price_1OCH4DF6A5ufQX5vQYB8fyDh' // $10 + $0.05 per GB
export const PROD_BUSINESS_PRICE_ID = 'price_1OCHHeF6A5ufQX5veYO8Q4xQ' // $100 + $0.03 per GB

export const STAGE_STARTER_PRICE_ID = 'price_1QIDBqF6A5ufQX5vNtPSVHUh' // $0 + $0.15 per GB
export const STAGE_LITE_PRICE_ID = 'price_1QIDCyF6A5ufQX5v3BV9mbTn' // $10 + $0.05 per GB
export const STAGE_BUSINESS_PRICE_ID = 'price_1OCg7nF6A5ufQX5vGV56jkB7' // $100 + $0.03 per GB

/**
 * @typedef {{ flatFee: string, overageFee: string, egressFee: string }} PriceCombo
 * @typedef {{ [priceId: string]: PriceCombo }} PriceComboMap
 * @typedef {{ prod: PriceComboMap, staging: PriceComboMap }} OldToNewPricesType
 */

/**
 * Mapping of old prices to new price combinations by environment
 * 
 * @type {OldToNewPricesType}
 */
export const oldToNewPrices = {
  prod: {
    [PROD_STARTER_PRICE_ID]: {
      flatFee: 'price_1SUtuZF6A5ufQX5vLdJgK8gW',
      overageFee: 'price_1SUtv3F6A5ufQX5vTZHG0J7s',
      egressFee: 'price_1SUtv6F6A5ufQX5v4w4JmhoU'
    },
    [PROD_LITE_PRICE_ID]: {
      flatFee: 'price_1SUtvAF6A5ufQX5vM1Dc3Kpl',
      overageFee: 'price_1SUtvEF6A5ufQX5vI9ReH4wb',
      egressFee: 'price_1SUtvIF6A5ufQX5v2AKQcSKf',
    },
    [PROD_BUSINESS_PRICE_ID]: {
      flatFee: 'price_1SUtvLF6A5ufQX5vjHMdUcHh',
      overageFee: 'price_1SUtvOF6A5ufQX5vO9WL1jF7',
      egressFee: 'price_1SUtvSF6A5ufQX5vaTkB55xm'
    },
  },
  staging: {
    [STAGE_STARTER_PRICE_ID]: {
      flatFee: 'price_1SJMcVF6A5ufQX5voRJSNUWT',
      overageFee: 'price_1SJMfPF6A5ufQX5vdfInsdls',
      egressFee: 'price_1SJMgMF6A5ufQX5vVX927Uvx'
    },
    [STAGE_LITE_PRICE_ID]: {
      flatFee: 'price_1SKRC5F6A5ufQX5vRpsfsnAV',
      overageFee: 'price_1SKRFHF6A5ufQX5vE4YQ0dk2',
      egressFee: 'price_1SKRGrF6A5ufQX5v2XXj8FwQ',
    },
    [STAGE_BUSINESS_PRICE_ID]: {
      flatFee: 'price_1SKRJSF6A5ufQX5vXZrDTvW8',
      overageFee: 'price_1SKRRkF6A5ufQX5vLlfGHtG1',
      egressFee: 'price_1SKRWCF6A5ufQX5vlkNUeTBz'
    },
  }
}

export const oldPriceIds = {
  prod: [
    PROD_STARTER_PRICE_ID,
    PROD_LITE_PRICE_ID,
    PROD_BUSINESS_PRICE_ID
  ],
  staging: [
    STAGE_STARTER_PRICE_ID,
    STAGE_LITE_PRICE_ID,
    STAGE_BUSINESS_PRICE_ID
  ]
}

/**
 * @type {{ [priceId: string]: string }}
 */
export const oldPricesNames = {
  [PROD_STARTER_PRICE_ID]: 'STARTER',
  [PROD_LITE_PRICE_ID]: 'LITE',
  [PROD_BUSINESS_PRICE_ID]: 'BUSINESS',
  [STAGE_STARTER_PRICE_ID]: 'STARTER (staging)',
  [STAGE_LITE_PRICE_ID]: 'LITE (staging)',
  [STAGE_BUSINESS_PRICE_ID]: 'BUSINESS (staging)',
}

/**
 * @type {{ [priceId: string]: number }}
 */
export const oldPricesValue = {
  [PROD_STARTER_PRICE_ID]: 0, // $0
  [PROD_LITE_PRICE_ID]: 10 * 100, // $10
  [PROD_BUSINESS_PRICE_ID]: 100 * 100, // $100
  [STAGE_STARTER_PRICE_ID]: 0,
  [STAGE_LITE_PRICE_ID]: 10 * 100,
  [STAGE_BUSINESS_PRICE_ID]: 100 * 100,
}