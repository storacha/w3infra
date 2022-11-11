import test from 'ava'
import { GenericContainer as Container } from 'testcontainers'

import { parse } from '@ipld/dag-ucan/did'
import { CAR } from '@ucanto/transport'

import getServiceDid from '../../authority.js'
import { handler } from '../../functions/ucan-invocation-router.js'

import { alice } from '../fixtures.js'

test.before(async t => {
  await new Container('amazon/dynamodb-local:latest')
    .withExposedPorts(8000)
    .start()
})

// TODO: Need to set ENV for dbEndpoint...
test.skip('ucan-invocation-router', async (t) => {
  const serviceDid = await getServiceDid()

  const account = alice.did()
  const bytes = new Uint8Array([11, 22, 34, 44, 55])
  const link = await CAR.codec.link(bytes)

  const request = await CAR.encode([
    {
      issuer: alice,
      audience: parse(serviceDid.did()),
      capabilities: [{
        can: 'store/add',
        with: account,
        nb: { link },
      }],
      proofs: [],
    }
  ])

  // @ts-ignore convert to AWS type?
  const storeAddResponse = await handler(request)
  t.is(storeAddResponse.statusCode, 200)
})
