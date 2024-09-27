import { base32 } from 'multiformats/bases/base32'

/** @type {import('../lib.js').Bucket[]} */
export const buckets = [
  {
    name: process.env.S3_DOTSTORAGE_0_BUCKET_NAME,
    region: process.env.S3_DOTSTORAGE_0_BUCKET_REGION,
    toKey: root => {
      const s = root.toV1().toString(base32)
      return `complete/${s}/${s}.car`
    }
  },
  {
    name: process.env.S3_DOTSTORAGE_1_BUCKET_NAME,
    region: process.env.S3_DOTSTORAGE_1_BUCKET_REGION,
    toKey: root => {
      const s = root.toV1().toString(base32)
      return `complete/${s}/${s}.car`
    }
  },
  {
    name: process.env.S3_PICKUP_BUCKET_NAME,
    region: process.env.S3_PICKUP_BUCKET_REGION,
    toKey: r => `pickup/${r}/${r}.root.car`
  }
]
