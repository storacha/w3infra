import { base32 } from 'multiformats/bases/base32'
import { S3Client } from '@aws-sdk/client-s3'
import { createDudeWhereLocator, createHashEncodedInKeyHasher, createObjectHasher, createObjectLocator } from './lib.js'
import { mustGetEnv } from '../lib/env.js'

/** @type {import('./lib.js').Bucket[]} */
export const buckets = [
  {
    locator: createObjectLocator(
      new S3Client({ region: mustGetEnv('S3_DOTSTORAGE_0_BUCKET_REGION') }),
      mustGetEnv('S3_DOTSTORAGE_0_BUCKET_NAME'),
      root => `complete/${root.toV1().toString(base32)}.car`
    ),
    hasher: createObjectHasher()
  },
  {
    locator: createObjectLocator(
      new S3Client({ region: mustGetEnv('S3_DOTSTORAGE_1_BUCKET_REGION') }),
      mustGetEnv('S3_DOTSTORAGE_1_BUCKET_NAME'),
      root => `complete/${root.toV1().toString(base32)}.car`
    ),
    hasher: createObjectHasher()
  },
  {
    locator: createObjectLocator(
      new S3Client({ region: mustGetEnv('S3_PICKUP_BUCKET_REGION') }),
      mustGetEnv('S3_PICKUP_BUCKET_NAME'),
      r => `pickup/${r}/${r}.root.car`
    ),
    hasher: createObjectHasher()
  },
  {
    locator: createDudeWhereLocator(
      new S3Client({
        endpoint: mustGetEnv('R2_ENDPOINT'),
        credentials: {
          accessKeyId: mustGetEnv('R2_ACCESS_KEY_ID'),
          secretAccessKey: mustGetEnv('R2_SECRET_ACCESS_KEY'),
        },
        region: mustGetEnv('R2_REGION')
      }),
      mustGetEnv('R2_DUDEWHERE_BUCKET_NAME'),
      mustGetEnv('R2_CARPARK_BUCKET_NAME')
    ),
    hasher: createHashEncodedInKeyHasher()
  }
]
