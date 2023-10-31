export type InferStoreRecord<T> = {
  [Property in keyof T]: T[Property] extends Number ? T[Property] : string
}

/** A record that is of suitable type to be put in DynamoDB. */
export type StoreRecord = Record<string, string|number>

// would be generated by sst, but requires `sst build` to be run, which calls out to aws; not great for CI
declare module '@serverless-stack/node/config' {
  export interface SecretResources {
    STRIPE_SECRET_KEY: {
      value: string
    }
    STRIPE_ENDPOINT_SECRET: {
      value: string
    }
  }
}
