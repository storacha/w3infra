import { Api } from '@serverless-stack/resources'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function ApiStack({ stack }) {
  const api = new Api(stack, 'api', {
    routes: {
      'GET /hello': 'functions/hello.handler',
    },
  })

  stack.addOutputs({
    ApiEndpoint: api.url,
  })
}
