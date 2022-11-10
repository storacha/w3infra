import test from 'ava'

import { handler } from '../functions/hello.js'

test('sample', (t) => {
  const helloResponse = handler({
    // @ts-ignore not all properties needed
    requestContext: {
      time: (new Date()).toDateString()
    }
  })
  t.is(helloResponse.statusCode, 200)
})
