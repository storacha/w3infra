import * as Raw from 'multiformats/codecs/raw'

export const RAW_CODE = Raw.code

/** https://github.com/multiformats/multicodec/blob/master/table.csv#L140 */
export const CAR_CODE = 0x02_02

/** https://github.com/multiformats/multicodec/blob/master/table.csv#L520 */
export const PIECE_V1_CODE = 0xf1_01

/** https://github.com/multiformats/multicodec/blob/master/table.csv#L151 */
export const PIECE_V1_MULTIHASH = 0x10_12

/** https://github.com/multiformats/multicodec/pull/331/files */
export const PIECE_V2_MULTIHASH = 0x10_11

export const CARPARK_DOMAIN =
  `carpark-${process.env.SST_STAGE ?? 'dev'}-0.r2.w3s.link`
