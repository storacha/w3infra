import { DynamoDB } from '@aws-sdk/client-dynamodb'

export const getDynamo = () => {
  let credentials
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  }
  return new DynamoDB({ region: process.env.AWS_REGION, credentials })
}
