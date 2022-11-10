/**
 * @param {import('aws-lambda').APIGatewayProxyEventV2} event 
 */
function helloHandler (event) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain' },
    body: `Hello, World! Your request was received at ${event.requestContext.time}.`,
  }
}

export const handler = helloHandler
