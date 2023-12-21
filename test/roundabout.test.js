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
  const carparkCid = 'bagbaieraky3zsxcozokb33wunu5bmxixfpkz2t2pe25rs6tokqcgm3h3d5ya'
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
  const pieceCid = 'bafkzcibband7offrs5xxampc4etmefycbsoyu2qqav6sbjbmuzhoeetht5ncs'
  const carCid = 'bagbaieraky3zsxcozokb33wunu5bmxixfpkz2t2pe25rs6tokqcgm3h3d5ya'
  const response = await fetch(
    `${t.context.roundaboutEndpoint}/${pieceCid}`,
    {
      method: 'HEAD',
      redirect: 'manual'
    }
  )
  t.is(response.status, 302)
  const location = response.headers.get('location')
  t.truthy(location)
  t.true(location.includes(carCid))
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
