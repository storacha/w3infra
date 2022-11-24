import { test } from '../helpers/context.js'

import parseSqsEvent from '../../utils/parse-sqs-event.js'

test('parse sqs event from current CAR keys', (t) => {
  const sqsEvent = {
    Records: [
      {
        body: 'us-east-2/w3up-cars/bagbaiera22227qz2m5rgyuw6ok5mxui7daacloos3kfyynuqxqa3svguhp4a/bagbaiera22227qz2m5rgyuw6ok5mxui7daacloos3kfyynuqxqa3svguhp4a.car',
      },
    ],
  }

  // @ts-expect-error not complete event
  const record = parseSqsEvent(sqsEvent)
  t.is(record?.bucketName, 'w3up-cars')
  t.is(record?.bucketRegion, 'us-east-2')
  t.is(record?.key,
    'bagbaiera22227qz2m5rgyuw6ok5mxui7daacloos3kfyynuqxqa3svguhp4a/bagbaiera22227qz2m5rgyuw6ok5mxui7daacloos3kfyynuqxqa3svguhp4a.car'
  )
})

test('parse sqs event from old CAR keys', (t) => {
  const sqsEvent = {
    Records: [
      {
        body: 'us-east-2/dotstorage-prod-0/raw/bafkreidagwor4wsxxktnj66ph6ps6gw5cje445ne4oj4de5hgafvsdbdk4/nft-32259/xyz.car',
      },
    ],
  }

  // @ts-expect-error not complete event
  const record = parseSqsEvent(sqsEvent)
  t.is(record?.bucketName, 'dotstorage-prod-0')
  t.is(record?.bucketRegion, 'us-east-2')
  t.is(record?.key,
    'raw/bafkreidagwor4wsxxktnj66ph6ps6gw5cje445ne4oj4de5hgafvsdbdk4/nft-32259/xyz.car'
  )
})

test('parse sqs event fails when multiple records are received', (t) => {
  const sqsEvent = {
    Records: [
      {
        body: 'us-east-2/w3up-cars/bagbaiera22227qz2m5rgyuw6ok5mxui7daacloos3kfyynuqxqa3svguhp4a/bagbaiera22227qz2m5rgyuw6ok5mxui7daacloos3kfyynuqxqa3svguhp4a.car',
      },
      {
        body: 'us-east-2/w3up-cars/bagbaiera22227qz2m5rgyuw6ok5mxui7daacloos3kfyynuqxqa3svguhp4a/bagbaiera22227qz2m5rgyuw6ok5mxui7daacloos3kfyynuqxqa3svguhp4a.car',
      },
    ],
  }

  // @ts-expect-error not complete event
  t.throws(() => parseSqsEvent(sqsEvent), { message: /^Expected 1 CAR per invocation but received 2 CARs$/ })
})
