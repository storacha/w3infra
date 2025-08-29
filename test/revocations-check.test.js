import { fetch } from '@web-std/fetch'
import { test } from './helpers/context.js'
import { getApiEndpoint } from './helpers/deployment.js'
import * as Link from 'multiformats/link'
import { sha256 } from 'multiformats/hashes/sha2'

/**
 * Helper to create test CIDs
 *
 * @param {number} count
 */
async function createTestCIDs(count = 3) {
  const cids = []
  for (let i = 0; i < count; i++) {
    const data = new Uint8Array([i + 10, i + 11, i + 12, i + 13, i + 14, i + 15, i + 16, i + 17])
    const hash = await sha256.digest(data)
    const cid = Link.create(0x55, hash)
    cids.push(cid.toString())
  }
  return cids
}

test('POST /revocations/check - integration test with valid CIDs', async (t) => {
  const testCIDs = await createTestCIDs(3)
  
  const response = await fetch(`${getApiEndpoint()}/revocations/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      cids: testCIDs
    })
  })

  t.is(response.status, 200)
  t.is(response.headers.get('content-type'), 'application/json')
  t.is(response.headers.get('access-control-allow-origin'), '*')
  t.is(response.headers.get('access-control-allow-methods'), 'POST')

  const body = await response.json()
  t.truthy(body.revocations)
  t.is(typeof body.revocations, 'object')
  
  // Since we're testing with random CIDs that don't exist, 
  // we should get an empty revocations object
  t.deepEqual(body.revocations, {})
})

test('POST /revocations/check - integration test with invalid JSON', async (t) => {
  const response = await fetch(`${getApiEndpoint()}/revocations/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: 'invalid json'
  })

  t.is(response.status, 400)
  
  const body = await response.json()
  t.is(body.error, 'Invalid JSON')
  t.is(body.message, 'Request body must be valid JSON')
})

test('POST /revocations/check - integration test with missing cids field', async (t) => {
  const response = await fetch(`${getApiEndpoint()}/revocations/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      other: 'field'
    })
  })

  t.is(response.status, 400)
  
  const body = await response.json()
  t.is(body.error, 'Missing required field: cids')
  t.is(body.message, 'Please provide delegation CIDs as an array in the "cids" field')
})

test('POST /revocations/check - integration test with non-array cids', async (t) => {
  const response = await fetch(`${getApiEndpoint()}/revocations/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      cids: 'not-an-array'
    })
  })

  t.is(response.status, 400)
  
  const body = await response.json()
  t.is(body.error, 'Invalid field type: cids')
  t.is(body.message, 'The "cids" field must be an array of strings')
})

test('POST /revocations/check - integration test with empty cids array', async (t) => {
  const response = await fetch(`${getApiEndpoint()}/revocations/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      cids: []
    })
  })

  t.is(response.status, 400)
  
  const body = await response.json()
  t.is(body.error, 'Invalid parameter: cids')
  t.is(body.message, 'At least one delegation CID must be provided')
})

test('POST /revocations/check - integration test with too many CIDs', async (t) => {
  // Create 101 CIDs to exceed the limit
  const testCIDs = await createTestCIDs(101)
  
  const response = await fetch(`${getApiEndpoint()}/revocations/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      cids: testCIDs
    })
  })

  t.is(response.status, 400)
  
  const body = await response.json()
  t.is(body.error, 'Too many CIDs')
  t.is(body.message, 'Maximum 100 delegation CIDs can be checked in a single request')
})

test('POST /revocations/check - integration test with maximum allowed CIDs (100)', async (t) => {
  // Create exactly 100 CIDs (at the limit)
  const testCIDs = await createTestCIDs(100)
  
  const response = await fetch(`${getApiEndpoint()}/revocations/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      cids: testCIDs
    })
  })

  t.is(response.status, 200)
  
  const body = await response.json()
  t.truthy(body.revocations)
  t.is(typeof body.revocations, 'object')
  // Should return empty object since these are random test CIDs
  t.deepEqual(body.revocations, {})
})

test('POST /revocations/check - integration test with invalid CID format', async (t) => {
  const response = await fetch(`${getApiEndpoint()}/revocations/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      cids: ['invalid-cid-format']
    })
  })

  // Should return 400 due to CID parsing error (now handled gracefully)
  t.is(response.status, 400)
  
  const body = await response.json()
  t.is(body.error, 'Invalid CID format')
  t.truthy(body.message.includes('Invalid CID provided: invalid-cid-format'))
})

test('POST /revocations/check - integration test CORS preflight support', async (t) => {
  // Test that CORS headers are properly set for cross-origin requests
  const testCIDs = await createTestCIDs(1)
  
  const response = await fetch(`${getApiEndpoint()}/revocations/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://example.com'
    },
    body: JSON.stringify({
      cids: testCIDs
    })
  })

  t.is(response.status, 200)
  t.is(response.headers.get('access-control-allow-origin'), '*')
  t.is(response.headers.get('access-control-allow-methods'), 'POST')
  t.is(response.headers.get('access-control-allow-headers'), 'Content-Type')
})
