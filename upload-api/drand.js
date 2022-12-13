// @ts-ignore
import Chain from 'drand-client/chain.js'

const chainInfo = {
  public_key: '868f005eb8e6e4ca0a47c8a77ceaa5309a47978a7c71bc5cce96366b5d7a569937c529eeda66c7293784a9402801af31',
  period: 30,
  // eslint-disable-next-line unicorn/numeric-separators-style
  genesis_time: 1595431050,
  hash: '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce'
}

/**
 * @param {number} time
 */
export function roundAt (time) {
  return Chain.roundAt(time, chainInfo.genesis_time * 1000, chainInfo.period * 1000)
}
