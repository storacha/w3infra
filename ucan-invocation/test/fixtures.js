export const s3PutInvalidRecords = [
  {
    s3: {
      object: {
        key: 'bafkreigfrvnqxtgyazq2x5bzljvhrag3xfnfl4jnjvdiewc2fqb5vz5ddu/file.gif',
        size: 1000,
      },
      bucket: {
        name: 'ucan-store-prod-0'
      }
    },
    awsRegion: 'us-west-2'
  }
]

export const s3PutValidRecords = [
  {
    s3: {
      object: {
        key: 'bagbaieraujbjejtyjrx3qkwk4plekotl2oxwclil7sddc4fpdb5nl5mandjq.car',
        size: 1000,
      },
      bucket: {
        name: 'ucan-store-prod-0'
      }
    },
    awsRegion: 'us-west-2'
  },
  {
    s3: {
      object: {
        key: 'bagbaierabrh34ke7nujsmdodwlytoicthwykhx4autbhgsvn6rakq3hskxoq.car',
        size: 1000,
      },
      bucket: {
        name: 'ucan-store-prod-0'
      }
    },
    awsRegion: 'us-west-2'
  }
]
