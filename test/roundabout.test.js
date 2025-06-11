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

test('HEAD /{pieceCid}', async t => {
  const pieceCid = 'bafkzcibdr4dqmqbpd2sw5776tv4262dvtzyoftihg5jwflvvbvd7pxhebk3l45bt'
  const blobHash = 'zQmWw7DCqwG91Kxq9oBB24aMALTQ82iaTv861xn3e2zi1Ce'
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
