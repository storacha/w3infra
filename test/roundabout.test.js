import { testRoundabout as test } from './helpers/context.js'

import { fetch } from '@web-std/fetch'

import {
  getRoundaboutEndpoint
} from './helpers/deployment.js'

test.before(t => {
  t.context = {
    roundaboutEndpoint: getRoundaboutEndpoint(),
  }
})

// FIXME: uses live data in staging - will not pass in PRs
test('HEAD /{cid}', async t => {
  const carparkCid = 'bagbaiera223xmiutg62dsthdyd6kqgsft25knslnlaxxvwe6nc4zrwezezeq'
  const response = await fetch(
    `${t.context.roundaboutEndpoint}/${carparkCid}`,
    {
      method: 'HEAD',
      redirect: 'manual'
    }
  )
  t.is(response.status, 302)
  t.truthy(response.headers.get('location'))
})

// FIXME: uses live data in staging - will not pass in PRs
test('HEAD /{pieceCid}', async t => {
  const pieceCid = 'bafkzcibdr4dqmoetltnxbxun7ogidvbebjtux7luelji4uwnf6agxf3a4wukvlqp'
  const blobHash = 'zQmV41DP4sTCXdeN5x9JmisywagcuNAu41AswT7zzE95Nze'
  const response = await fetch(
    `${t.context.roundaboutEndpoint}/${pieceCid}`,
    {
      method: 'HEAD',
      redirect: 'manual'
    }
  )
  t.is(response.status, 302)
  const location = response.headers.get('location')
  if (!location) return t.fail('missing Location header in response')
  t.true(location.includes(blobHash))
  console.log(response.headers.get('location'))
})

// FIXME: uses live data in staging - will not pass in PRs
test('HEAD /key/{key}', async t => {
  const key = '0000c19bd9cd7fa9c532eba81428eda0_baga6ea4seaqpohse35l4xucs5mtabgewpp4mgtle7yym7em6ouvhgjb7wc2pcmq.car'
  const bucketName = 'dagcargo'
  const response = await fetch(
    `${t.context.roundaboutEndpoint}/key/${key}?bucket=${bucketName}`,
    {
      method: 'HEAD',
      redirect: 'manual'
    }
  )
  t.is(response.status, 302)
  t.truthy(response.headers.get('location'))
})
