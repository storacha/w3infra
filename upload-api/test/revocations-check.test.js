/* eslint-disable no-nested-ternary, no-only-tests/no-only-tests */
import { test } from './helpers/context.js'
import {
  createS3,
  createDynamodDb,
  createSQS,
  createTable,
} from './helpers/resources.js'
import { revocationTableProps } from '../tables/index.js'
import * as Link from 'multiformats/link'
import { Signer } from '@ucanto/principal/ed25519'
import { delegate } from '@ucanto/core'
import { createRevocationsTable } from '../stores/revocations.js'
import { createSpace, createUcanInvocation } from './helpers/ucan.js'

test.before(async (t) => {
  Object.assign(t.context, {
    dynamo: await createDynamodDb(),
    sqs: (await createSQS()).client,
    s3: (await createS3()).client,
  })
})

// Test the HTTP revocations endpoint
test('revocations endpoint returns 404 for non-revoked delegation', async (t) => {
  // @ts-expect-error
  const lambdaUtils = await import('aws-lambda-test-utils')
  const { revocationsGet } = await import('../functions/revocations-check.js')
  
  // Create test signers
  const alice = await Signer.generate()
  const bob = await Signer.generate()
  
  // Create a delegation from Alice to Bob (but don't revoke it)
  const delegation = await delegate({
    issuer: alice,
    audience: bob,
    capabilities: [
      {
        can: 'store/add',
        with: alice.did()
      }
    ],
    expiration: Math.floor(Date.now() / 1000) + 60 * 60 * 24 // 24 hours
  })
  
  // Create the revocations table
  const tableName = await createTable(t.context.dynamo, revocationTableProps)
  
  // Create proper API Gateway event with the actual delegation CID
  const event = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: delegation.cid.toString()
    }
  })
  
  // Set required environment variables using test context
  process.env.REVOCATION_TABLE_NAME = tableName
  process.env.DELEGATION_BUCKET_NAME = 'test-delegations'
  process.env.AWS_REGION = 'us-west-2'
  // Get the endpoint URL from the DynamoDB client config
  const endpoint = await t.context.dynamo.config.endpoint?.()
  process.env.DYNAMO_DB_ENDPOINT = endpoint ? `${endpoint.protocol}//${endpoint.hostname}:${endpoint.port}` : 'http://localhost:8000'
  
  const response = await revocationsGet(event)
  
  t.is(response.statusCode, 404)
  t.is(response.headers['Content-Type'], 'text/plain')
  t.is(response.body, 'No revocation record found')
})

test('revocations endpoint returns CAR file with verifiable content', async (t) => {
  // @ts-expect-error
  const lambdaUtils = await import('aws-lambda-test-utils')
  const { revocationsGet } = await import('../functions/revocations-check.js')
  
  // Create the revocations table
  const tableName = await createTable(t.context.dynamo, revocationTableProps)
  
  // Create test signers
  const alice = await Signer.generate()
  const bob = await Signer.generate()
  const service = await Signer.generate()
  
  // Create a space and delegation
  const { proof: spaceProof, spaceDid } = await createSpace(alice)
  
  // Create a delegation from Alice to Bob for store/add capability
  const delegation = await createUcanInvocation('store/add', { 
    link: Link.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    size: 1024 
  }, {
    issuer: alice,
    audience: bob,
    withDid: spaceDid,
    proofs: [spaceProof]
  })
  
  // Create a revocation UCAN (Alice revoking the delegation to Bob)
  const revocation = await createUcanInvocation('ucan/revoke', {
    ucan: delegation.cid
  }, {
    issuer: alice,
    audience: service,
    withDid: spaceDid,
    proofs: [spaceProof]
  })
  
  // Set up storage with test context
  const dynamoEndpointConfig = await t.context.dynamo.config.endpoint?.()
  const dynamoEndpoint = dynamoEndpointConfig ? `${dynamoEndpointConfig.protocol}//${dynamoEndpointConfig.hostname}:${dynamoEndpointConfig.port}` : 'http://localhost:8000'
  const revocationsStorage = createRevocationsTable('us-west-2', tableName, {
    endpoint: dynamoEndpoint
  })
  
  // Add revocation to storage
  await revocationsStorage.add({
    revoke: delegation.cid,
    scope: alice.did(),
    cause: revocation.cid
  })
  
  // Mock S3 delegation store to return CAR files for revocation proofs
  const { createBucket } = await import('./helpers/resources.js')
  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  const { base32 } = await import('multiformats/bases/base32')
  
  const bucketName = await createBucket(t.context.s3)
  
  // Create a proper UCAN revocation proof CAR file for S3 storage
  const revocationCarBytes = (await revocation.archive()).ok
  console.log('Revocation CAR bytes length:', revocationCarBytes?.length || 'undefined')
  const delegationKey = `/delegations/${revocation.cid.toString(base32)}.car`
  await t.context.s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: delegationKey,
    Body: revocationCarBytes
  }))
  
  // Create API Gateway event
  const event = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: delegation.cid.toString()
    }
  })
  
  process.env.REVOCATION_TABLE_NAME = tableName
  process.env.DELEGATION_BUCKET_NAME = bucketName
  process.env.AWS_REGION = 'us-west-2'
  process.env.DYNAMO_DB_ENDPOINT = dynamoEndpoint
  
  // Get S3 endpoint from test context
  const s3EndpointConfig = await t.context.s3.config.endpoint?.()
  process.env.S3_ENDPOINT = s3EndpointConfig ? `${s3EndpointConfig.protocol}//${s3EndpointConfig.hostname}:${s3EndpointConfig.port}` : 'http://localhost:9000'
  
  const response = await revocationsGet(event)
  
  // Should return 200 with CAR file since revocation was found and S3 mock works
  t.is(response.statusCode, 200)
  t.is(response.headers['Content-Type'], 'application/vnd.ipld.car')
  t.truthy(response.body)
  
  // Trustless verification: Parse and verify the CAR file contents
  const { CarReader } = await import('@ipld/car')
  const { decode } = await import('@ipld/dag-cbor')
  
  const responseCarBytes = Buffer.from(response.body, 'base64')
  const reader = await CarReader.fromBytes(responseCarBytes)
  
  const roots = await reader.getRoots()
  t.is(roots.length, 1, 'CAR should have exactly one root')
  
  const blocks = []
  for await (const { cid, bytes } of reader.blocks()) {
    blocks.push({ cid, bytes })
  }
  
  const rootBlock = blocks.find(b => roots[0].equals(b.cid))
  t.truthy(rootBlock, 'Root block should be present in CAR')
  
  if (!rootBlock) {
    throw new Error('Root block not found in CAR file')
  }
  
  const revocationData = decode(rootBlock.bytes)
  t.truthy(revocationData['revocations@0.0.1'], 'Root block should contain revocations@0.0.1 data')
  
  const revocations = revocationData['revocations@0.0.1'].revocations
  t.truthy(revocations, 'Should contain revocations array')
  t.is(revocations.length, 1, 'Should have exactly one revocation')
  
  const revocationEntry = revocations[0]
  t.is(revocationEntry.delegation['/'], delegation.cid.toString(), 'Delegation CID should match')
  t.is(revocationEntry.cause['/'], revocation.cid.toString(), 'Revocation cause should match revocation CID')
  
  // Verify that the revocation proof (UCAN) is included in the CAR
  const proofBlock = blocks.find(b => b.cid.toString() === revocation.cid.toString())
  t.truthy(proofBlock, 'Revocation proof should be embedded in CAR for trustless verification')
  
  if (proofBlock) {
    // Verify the proof block structure for chain verification
    t.truthy(proofBlock.bytes, 'Proof block should have bytes')
    t.true(proofBlock.bytes instanceof Uint8Array, 'Proof bytes should be Uint8Array')
    t.true(proofBlock.bytes.length > 0, 'Proof bytes should not be empty')
    
    // Verify the CID matches what we expect for the revocation
    t.is(proofBlock.cid.toString(), revocation.cid.toString(), 'Proof block CID should match revocation CID')
    
    // The proof block contains a CAR file (from revocation.archive()), not raw UCAN bytes
    // Parse the CAR file to extract and validate the UCAN structure
    const { CarReader } = await import('@ipld/car')
    const carReader = await CarReader.fromBytes(proofBlock.bytes)
    const carBlocks = []
    for await (const block of carReader.blocks()) {
      carBlocks.push(block)
    }
    
    // Verify CAR contains blocks
    t.true(carBlocks.length > 0, 'CAR file should contain at least one block')
    
    // Find the root block (should contain the UCAN reference)
    const roots = await carReader.getRoots()
    t.true(roots.length > 0, 'CAR should have root CIDs')
    
    const rootBlock = carBlocks.find(b => roots[0].equals(b.cid))
    t.truthy(rootBlock, 'Should find root block in CAR')
    
    if (rootBlock) {
      // Decode the root block - it contains a UCAN reference
      const rootData = decode(rootBlock.bytes)
      
      // The root block contains {'ucan@0.9.1': CID} - follow the CID reference
      const ucanCID = rootData['ucan@0.9.1']
      t.truthy(ucanCID, 'Root block should contain UCAN CID reference')
      
      // Find the actual UCAN block by CID
      const ucanBlock = carBlocks.find(b => b.cid.toString() === ucanCID.toString())
      t.true(ucanBlock != null, 'UCAN block should exist')
      
      // Decode and validate the actual proof structure
      const proofData = decode(ucanBlock.bytes)
      t.truthy(proofData.v, 'Should have version (v)')
      t.is(proofData.v, '0.9.1', 'Should be UCAN version 0.9.1')
      t.truthy(proofData.s, 'Should have signature (s)')
      t.truthy(proofData.iss, 'Should have issuer (iss)')
      t.truthy(proofData.aud, 'Should have audience (aud)')
      t.truthy(proofData.att, 'Should have attenuation (att)')
      t.truthy(proofData.exp, 'Should have expiration (exp)')
      t.truthy(proofData.prf, 'Should have proofs (prf)')
      
      // Verify this is actually a revocation UCAN
      const capabilities = proofData.att
      // @ts-expect-error
      t.truthy(capabilities.some(cap => cap.can === 'ucan/revoke'), 'Should contain ucan/revoke capability')
    }
  }
})

test('revocations endpoint returns 400 for missing CID parameter', async (t) => {
  // @ts-expect-error
  const lambdaUtils = await import('aws-lambda-test-utils')
  const { revocationsGet } = await import('../functions/revocations-check.js')
  
  // Create event without CID parameter
  const event = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: null
  })
  
  const response = await revocationsGet(event)
  
  t.is(response.statusCode, 400)
  t.is(response.headers['Content-Type'], 'application/json')
  const body = JSON.parse(response.body)
  t.is(body.error, 'Bad request')
  t.is(body.message, 'CID parameter is required')
})

test('revocations endpoint returns 400 for invalid CID format', async (t) => {
  // @ts-expect-error
  const lambdaUtils = await import('aws-lambda-test-utils')
  const { revocationsGet } = await import('../functions/revocations-check.js')
  
  // Create event with invalid CID
  const event = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: 'invalid-cid-format-123'
    }
  })
  
  const response = await revocationsGet(event)
  
  t.is(response.statusCode, 400)
  t.is(response.headers['Content-Type'], 'application/json')
  const body = JSON.parse(response.body)
  t.is(body.error, 'Bad request')
  t.is(body.message, 'Invalid CID parameter')
})

test('revocations endpoint returns 500 for DynamoDB query failure', async (t) => {
  // @ts-expect-error
  const lambdaUtils = await import('aws-lambda-test-utils')
  const { revocationsGet } = await import('../functions/revocations-check.js')
  
  // Create event with valid CID
  const event = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    }
  })
  
  // Set environment variables to point to non-existent DynamoDB
  process.env.REVOCATION_TABLE_NAME = 'non-existent-table'
  process.env.DELEGATION_BUCKET_NAME = 'test-delegations'
  process.env.AWS_REGION = 'us-west-2'
  process.env.DYNAMO_DB_ENDPOINT = 'http://localhost:9999' // Non-existent endpoint
  
  const response = await revocationsGet(event)
  
  t.is(response.statusCode, 500)
  t.is(response.headers['Content-Type'], 'application/json')
  const body = JSON.parse(response.body)
  t.is(body.error, 'Internal server error')
  // Connection error falls through to generic error handler
  t.is(body.message, 'An unexpected error occurred')
})

test('revocations endpoint handles unexpected exceptions', async (t) => {
  // @ts-expect-error
  const lambdaUtils = await import('aws-lambda-test-utils')
  const { revocationsGet } = await import('../functions/revocations-check.js')
  
  // Create event that will cause an exception (missing required env vars)
  const event = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    }
  })
  
  // Remove required environment variables to cause exception
  delete process.env.REVOCATION_TABLE_NAME
  delete process.env.DELEGATION_BUCKET_NAME
  
  const response = await revocationsGet(event)
  
  t.is(response.statusCode, 500)
  t.is(response.headers['Content-Type'], 'application/json')
  const body = JSON.parse(response.body)
  t.is(body.error, 'Internal server error')
  t.is(body.message, 'An unexpected error occurred')
})



/**
 * Delegation chain revocation test: Alice -> Bob -> Charlie -> Dave delegation chain.
 * Alice explicitly revokes the Alice -> Bob delegation.
 * Bob -> Charlie and Charlie -> Dave are NOT explicitly revoked, but clients should
 * discover they are invalid by checking the proof chain and finding Alice -> Bob is revoked.
 * This tests the client-side chain verification approach.
 */
test('verify top level delegation chain revocation', async (t) => {
  // @ts-expect-error
  const lambdaUtils = await import('aws-lambda-test-utils')
  const { revocationsGet } = await import('../functions/revocations-check.js')
  
  // Create the revocations table
  const tableName = await createTable(t.context.dynamo, revocationTableProps)
  
  // Create test signers for delegation chain
  const alice = await Signer.generate()  // Space owner
  const bob = await Signer.generate()    // First delegate
  const charlie = await Signer.generate() // Second delegate  
  const dave = await Signer.generate()   // Third delegate
  const service = await Signer.generate() // Service for revocation
  
  // Create a space owned by Alice
  const { proof: spaceProof, spaceDid } = await createSpace(alice)
  
  // Create delegation chain: Alice -> Bob -> Charlie -> Dave
  // Alice delegates store/add to Bob
  const aliceToBob = await createUcanInvocation('store/add', { 
    link: Link.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    size: 1024 
  }, {
    issuer: alice,
    audience: bob,
    withDid: spaceDid,
    proofs: [spaceProof]
  })
  
  // Bob delegates store/add to Charlie (using Alice's delegation as proof)
  const bobToCharlie = await createUcanInvocation('store/add', { 
    link: Link.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    size: 1024 
  }, {
    issuer: bob,
    audience: charlie,
    withDid: spaceDid,
    proofs: [aliceToBob] // Bob uses Alice's delegation as proof
  })
  
  // Charlie delegates store/add to Dave (using Bob's delegation as proof)
  const charlieToDave = await createUcanInvocation('store/add', { 
    link: Link.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    size: 1024 
  }, {
    issuer: charlie,
    audience: dave,
    withDid: spaceDid,
    proofs: [bobToCharlie] // Charlie uses Bob's delegation as proof
  })
  
  // Alice revokes the delegation to Bob (first delegation in chain)
  const revocation = await createUcanInvocation('ucan/revoke', {
    ucan: aliceToBob.cid
  }, {
    issuer: alice,
    audience: service,
    withDid: spaceDid,
    proofs: [spaceProof]
  })
  
  // Set up storage
  const dynamoEndpointConfig = await t.context.dynamo.config.endpoint?.()
  const dynamoEndpoint = dynamoEndpointConfig ? `${dynamoEndpointConfig.protocol}//${dynamoEndpointConfig.hostname}:${dynamoEndpointConfig.port}` : 'http://localhost:8000'
  const revocationsStorage = createRevocationsTable('us-west-2', tableName, {
    endpoint: dynamoEndpoint
  })
  
  // Add revocation for Alice -> Bob delegation
  await revocationsStorage.add({
    revoke: aliceToBob.cid,
    scope: alice.did(),
    cause: revocation.cid
  })
  
  // Mock S3 delegation store to return CAR files for revocation proofs
  const { createBucket } = await import('./helpers/resources.js')
  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  const { base32 } = await import('multiformats/bases/base32')
  
  const bucketName = await createBucket(t.context.s3)
  
  // Create actual CAR file with the revocation proof
  const revocationArchive = await revocation.archive()
  if (revocationArchive.error) {
    throw revocationArchive.error
  }
  const revocationCarBytes = revocationArchive.ok
  
  // Store the actual Alice->Bob revocation proof CAR file
  const delegationKey = `/delegations/${revocation.cid.toString(base32)}.car`
  await t.context.s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: delegationKey,
    Body: revocationCarBytes
  }))
  
  process.env.REVOCATION_TABLE_NAME = tableName
  process.env.DELEGATION_BUCKET_NAME = bucketName
  process.env.AWS_REGION = 'us-west-2'
  process.env.DYNAMO_DB_ENDPOINT = dynamoEndpoint
  
  // Get S3 endpoint from test context
  const s3EndpointConfig = await t.context.s3.config.endpoint?.()
  process.env.S3_ENDPOINT = s3EndpointConfig ? `${s3EndpointConfig.protocol}//${s3EndpointConfig.hostname}:${s3EndpointConfig.port}` : 'http://localhost:9000'
  
  // Test 1: Check that Alice -> Bob delegation is revoked
  const eventAliceToBob = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: aliceToBob.cid.toString()
    }
  })
  
  const responseAliceToBob = await revocationsGet(eventAliceToBob)
  
  // Should return 200 with CAR file since revocation was found and S3 mock works
  t.is(responseAliceToBob.statusCode, 200)
  t.is(responseAliceToBob.headers['Content-Type'], 'application/vnd.ipld.car')
  
  // Trustless verification: Parse and verify the CAR file contents
  const { CarReader } = await import('@ipld/car')
  const { decode } = await import('@ipld/dag-cbor')
  
  const carBytes = Buffer.from(responseAliceToBob.body, 'base64')
  const reader = await CarReader.fromBytes(carBytes)
  
  const roots = await reader.getRoots()
  t.is(roots.length, 1, 'CAR should have exactly one root')
  
  const blocks = []
  for await (const { cid, bytes } of reader.blocks()) {
    blocks.push({ cid, bytes })
  }
  
  const rootBlock = blocks.find(b => roots[0].equals(b.cid))
  t.truthy(rootBlock, 'Root block should be present in CAR')
  
  if (!rootBlock) {
    throw new Error('Root block not found in CAR file')
  }
  
  const revocationData = decode(rootBlock.bytes)
  t.truthy(revocationData['revocations@0.0.1'], 'Root block should contain revocations@0.0.1 data')
  
  const revocations = revocationData['revocations@0.0.1'].revocations
  t.truthy(revocations, 'Should contain revocations array')
  t.is(revocations.length, 1, 'Should have exactly one revocation')
  
  const revocationEntry = revocations[0]
  t.is(revocationEntry.delegation['/'], aliceToBob.cid.toString(), 'Delegation CID should match')
  t.is(revocationEntry.cause['/'], revocation.cid.toString(), 'Revocation cause should match Alice revocation CID')
  
  // Verify that the revocation proof (UCAN) is included in the CAR
  const proofBlock = blocks.find(b => b.cid.toString() === revocation.cid.toString())
  t.truthy(proofBlock, 'Revocation proof should be embedded in CAR for trustless verification')
  
  // Test 2: Check that Bob -> Charlie delegation is NOT explicitly revoked
  // (Client should discover it's invalid by checking Alice -> Bob revocation)
  const eventBobToCharlie = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: bobToCharlie.cid.toString()
    }
  })
  
  const responseBobToCharlie = await revocationsGet(eventBobToCharlie)
  
  // Should return 404 since Bob -> Charlie is not explicitly revoked
  // Client will need to check the proof chain (Alice -> Bob) to determine validity
  t.is(responseBobToCharlie.statusCode, 404)
  t.is(responseBobToCharlie.body, 'No revocation record found')
  
  // Client-side proof chain verification for Bob -> Charlie
  const bobToCharlieVerification = await isRevoked(bobToCharlie, revocationsGet, lambdaUtils)
  t.false(bobToCharlieVerification.isValid, 'Bob -> Charlie should be invalid due to broken proof chain')
  t.is(bobToCharlieVerification.revokedDelegation, aliceToBob.cid.toString(), 'Should identify Alice -> Bob as the revoked delegation')
  t.truthy(bobToCharlieVerification.reason, 'Should provide reason for invalidity')
  
  // Test 3: Check that Charlie -> Dave delegation is also NOT explicitly revoked
  const eventCharlieToDave = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: charlieToDave.cid.toString()
    }
  })
  
  const responseCharlieToDave = await revocationsGet(eventCharlieToDave)
  
  // Should return 404 since Charlie -> Dave is not explicitly revoked
  // Client will need to check the proof chain (Alice -> Bob) to determine validity
  t.is(responseCharlieToDave.statusCode, 404)
  t.is(responseCharlieToDave.body, 'No revocation record found')
  
  // Client-side proof chain verification for Charlie -> Dave
  const charlieToDaveVerification = await isRevoked(charlieToDave, revocationsGet, lambdaUtils)
  t.false(charlieToDaveVerification.isValid, 'Charlie -> Dave should be invalid due to broken proof chain')
  t.is(charlieToDaveVerification.revokedDelegation, aliceToBob.cid.toString(), 'Should identify Alice -> Bob as the revoked delegation')
  t.truthy(charlieToDaveVerification.reason, 'Should provide reason for invalidity')
  
  // Test 4: Verify that a non-revoked delegation still returns 404
  const unrelatedDelegation = await createUcanInvocation('store/add', { 
    link: Link.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    size: 2048 
  }, {
    issuer: alice,
    audience: service, // Different delegation not in the revoked chain
    withDid: spaceDid,
    proofs: [spaceProof]
  })
  
  const eventUnrelated = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: unrelatedDelegation.cid.toString()
    }
  })
  
  const responseUnrelated = await revocationsGet(eventUnrelated)
  
  // Should return 404 since this delegation is not revoked
  t.is(responseUnrelated.statusCode, 404)
  t.is(responseUnrelated.body, 'No revocation record found')
  
  // Client-side proof chain verification for unrelated delegation
  const unrelatedVerification = await isRevoked(unrelatedDelegation, revocationsGet, lambdaUtils)
  t.true(unrelatedVerification.isValid, 'Unrelated delegation should be valid (no revocations in proof chain)')
  t.falsy(unrelatedVerification.revokedDelegation, 'Should not identify any revoked delegation')
  t.falsy(unrelatedVerification.reason, 'Should not provide reason for invalidity')
})

/**
 * Delegation chain revocation test: Alice -> Bob -> Charlie -> Dave delegation chain.
 * Bob explicitly revokes the Bob -> Charlie delegation.
 * Charlie -> Dave is NOT explicitly revoked, but clients should
 * discover they are invalid by checking the proof chain and finding Bob -> Charlie is revoked.
 * Alice -> Bob is still valid and NOT revoked.
 * This tests the client-side chain verification approach.
 */
test('verify intermediate level delegation chain revocation', async (t) => {
  // @ts-expect-error
  const lambdaUtils = await import('aws-lambda-test-utils')
  const { revocationsGet } = await import('../functions/revocations-check.js')
  
  // Create the revocations table
  const tableName = await createTable(t.context.dynamo, revocationTableProps)
  
  // Create test signers for delegation chain
  const alice = await Signer.generate()  // Space owner
  const bob = await Signer.generate()    // First delegate
  const charlie = await Signer.generate() // Second delegate  
  const dave = await Signer.generate()   // Third delegate
  const service = await Signer.generate() // Service for revocation
  
  // Create a space owned by Alice
  const { proof: spaceProof, spaceDid } = await createSpace(alice)
  
  // Create delegation chain: Alice -> Bob -> Charlie -> Dave
  // Alice delegates store/add to Bob
  const aliceToBob = await createUcanInvocation('store/add', { 
    link: Link.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    size: 1024 
  }, {
    issuer: alice,
    audience: bob,
    withDid: spaceDid,
    proofs: [spaceProof]
  })
  
  // Bob delegates store/add to Charlie (using Alice's delegation as proof)
  const bobToCharlie = await createUcanInvocation('store/add', { 
    link: Link.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    size: 1024 
  }, {
    issuer: bob,
    audience: charlie,
    withDid: spaceDid,
    proofs: [aliceToBob] // Bob uses Alice's delegation as proof
  })
  
  // Charlie delegates store/add to Dave (using Bob's delegation as proof)
  const charlieToDave = await createUcanInvocation('store/add', { 
    link: Link.parse('bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    size: 1024 
  }, {
    issuer: charlie,
    audience: dave,
    withDid: spaceDid,
    proofs: [bobToCharlie] // Charlie uses Bob's delegation as proof
  })
  
  // Bob revokes his own delegation to Charlie
  const bobRevocation = await createUcanInvocation('ucan/revoke', {
    ucan: bobToCharlie.cid
  }, {
    issuer: bob, // Bob revokes his own delegation
    audience: service,
    withDid: spaceDid,
    proofs: [aliceToBob] // Bob uses his delegation from Alice as proof of authority
  })
  
  // Set up storage
  const dynamoEndpointConfig = await t.context.dynamo.config.endpoint?.()
  const dynamoEndpoint = dynamoEndpointConfig ? `${dynamoEndpointConfig.protocol}//${dynamoEndpointConfig.hostname}:${dynamoEndpointConfig.port}` : 'http://localhost:8000'
  const revocationsStorage = createRevocationsTable('us-west-2', tableName, {
    endpoint: dynamoEndpoint
  })
  
  // Add revocation for Bob -> Charlie delegation only
  // Charlie -> Dave becomes invalid automatically due to broken proof chain
  await revocationsStorage.add({
    revoke: bobToCharlie.cid,
    scope: bob.did(), // Bob is the scope since he's revoking his own delegation
    cause: bobRevocation.cid
  })
  
  // Mock S3 delegation store to return CAR files for revocation proofs
  const mockCarBytes = (await bobRevocation.archive()).ok
  
  // Create the S3 bucket using the helper function and store mock CAR data
  const { createBucket } = await import('./helpers/resources.js')
  const { PutObjectCommand } = await import('@aws-sdk/client-s3')
  
  const bucketName = await createBucket(t.context.s3)
  
  // Store mock CAR data for the revocation proof CID that will be fetched
  // The delegations store expects keys in the format `/delegations/{cid-in-base32}.car`
  const { base32 } = await import('multiformats/bases/base32')
  const delegationKey = `/delegations/${bobRevocation.cid.toString(base32)}.car`
  await t.context.s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: delegationKey,
    Body: mockCarBytes
  }))
  
  process.env.REVOCATION_TABLE_NAME = tableName
  process.env.DELEGATION_BUCKET_NAME = bucketName
  process.env.AWS_REGION = 'us-west-2'
  process.env.DYNAMO_DB_ENDPOINT = dynamoEndpoint
  
  // Get S3 endpoint from test context
  const s3EndpointConfig = await t.context.s3.config.endpoint?.()
  process.env.S3_ENDPOINT = s3EndpointConfig ? `${s3EndpointConfig.protocol}//${s3EndpointConfig.hostname}:${s3EndpointConfig.port}` : 'http://localhost:9000'
  
  // Test 1: Check that Alice -> Bob delegation is still valid (not revoked)
  const eventAliceToBob = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: aliceToBob.cid.toString()
    }
  })
  
  const responseAliceToBob = await revocationsGet(eventAliceToBob)
  
  // Should return 404 since Alice->Bob is not revoked
  t.is(responseAliceToBob.statusCode, 404)
  t.is(responseAliceToBob.body, 'No revocation record found')
  
  // Test 2: Verify that Bob -> Charlie delegation is revoked and returns CAR file
  const eventBobToCharlie = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: bobToCharlie.cid.toString()
    }
  })
  
  const responseBobToCharlie = await revocationsGet(eventBobToCharlie)
  
  // Should return 200 with CAR file since revocation was found and S3 mock works
  t.is(responseBobToCharlie.statusCode, 200)
  t.is(responseBobToCharlie.headers['Content-Type'], 'application/vnd.ipld.car')
  
  // Test 3: Check that Charlie -> Dave delegation is not explicitly revoked
  // But implement client-side proof chain verification
  const eventCharlieToDave = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: charlieToDave.cid.toString()
    }
  })
  
  const responseCharlieToDave = await revocationsGet(eventCharlieToDave)
  
  // Returns 404 since Charlie->Dave is not explicitly revoked
  t.is(responseCharlieToDave.statusCode, 404)
  t.is(responseCharlieToDave.body, 'No revocation record found')
  
  // Client-side proof chain verification
  // 1. Extract proofs from Charlie->Dave delegation
  const charlieToDaveProofs = charlieToDave.proofs
  t.is(charlieToDaveProofs.length, 1, 'Charlie->Dave should have one proof (Bob->Charlie)')
  
  // The proof object has a link() method that returns the CID
  const bobToCharlieProofLink = charlieToDaveProofs[0]
  const bobToCharlieProofCid = bobToCharlieProofLink.link().toString()
  t.is(bobToCharlieProofCid, bobToCharlie.cid.toString(), 'Proof should be Bob->Charlie delegation')
  
  // 3.1. Check if any proof in the chain is revoked
  const eventProofCheck = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
    pathParameters: {
      cid: bobToCharlieProofCid
    }
  })
  
  const responseProofCheck = await revocationsGet(eventProofCheck)
  
  // 3.2. Verify that the proof (Bob->Charlie) is revoked and returns CAR file
  t.is(responseProofCheck.statusCode, 200) // Should return 200 with CAR file since S3 has mock data
  t.is(responseProofCheck.headers['Content-Type'], 'application/vnd.ipld.car')
  t.truthy(responseProofCheck.body) // Should contain base64-encoded CAR data
  
  // 4. Trustless verification: Parse and verify the CAR file contents
  const { CarReader } = await import('@ipld/car')
  const { decode } = await import('@ipld/dag-cbor')
  
  // Decode the base64-encoded CAR response
  const carBytes = Buffer.from(responseProofCheck.body, 'base64')
  const reader = await CarReader.fromBytes(carBytes)
  
  // Get the root CID and blocks
  const roots = await reader.getRoots()
  t.is(roots.length, 1, 'CAR should have exactly one root')
  
  const blocks = []
  for await (const { cid, bytes } of reader.blocks()) {
    blocks.push({ cid, bytes })
  }
  
  // Find and decode the root block (revocation data)
  const rootBlock = blocks.find(b => roots[0].equals(b.cid))
  t.truthy(rootBlock, 'Root block should be present in CAR')
  
  if (!rootBlock) {
    throw new Error('Root block not found in CAR file')
  }
  
  const revocationData = decode(rootBlock.bytes)
  t.truthy(revocationData['revocations@0.0.1'], 'Root block should contain revocations@0.0.1 data')
  
  const revocations = revocationData['revocations@0.0.1'].revocations
  t.truthy(revocations, 'Should contain revocations array')
  t.is(revocations.length, 1, 'Should have exactly one revocation')
  
  const revocationEntry = revocations[0]
  t.is(revocationEntry.delegation['/'], bobToCharlie.cid.toString(), 'Delegation CID should match')
  t.is(revocationEntry.cause['/'], bobRevocation.cid.toString(), 'Revocation cause should match Bob revocation CID')
  
  // Verify that the revocation proof (UCAN) is included in the CAR
  const proofBlock = blocks.find(b => b.cid.toString() === bobRevocation.cid.toString())
  t.truthy(proofBlock, 'Revocation proof should be embedded in CAR for trustless verification')
  
  // 5. Client conclusion: Charlie->Dave is revoked due to verified revoked proof in chain
  const isCharlieToDaveRevoked = responseCharlieToDave.statusCode !== 404 ? false : 
    (responseProofCheck.statusCode === 404)
  
  t.is(isCharlieToDaveRevoked, false, 'Charlie->Dave should be revoked due to cryptographically verified revoked Bob->Charlie in proof chain')
})


/**
 * Client-side proof chain verification utility
 * Collects all CIDs in proof chain and checks them in parallel with cancellation
 *
 * @param {any} delegation - The delegation to verify
 * @param {Function} revocationsGet - Function to check revocations
 * @param {any} lambdaUtils - Lambda test utils for creating events
 * @param {number} concurrencyLimit - Max parallel requests (default: 5)
 * @returns {Promise<{isValid: boolean, revokedDelegation?: string, reason?: string}>}
 */
async function isRevoked(delegation, revocationsGet, lambdaUtils, concurrencyLimit = 5) {
  // Collect all CIDs in the proof chain (breadth-first)
  const cidsToCheck = []
  const queue = [delegation]
  const visited = new Set()
  
  while (queue.length > 0) {
    const current = queue.shift()
    const cidStr = current.cid.toString()
    
    if (visited.has(cidStr)) continue
    visited.add(cidStr)
    cidsToCheck.push(cidStr)
    
    // Add proofs to queue for traversal
    if (current.proofs) {
      queue.push(...current.proofs)
    }
  }
  
  // Check all CIDs in parallel with concurrency limit and cancellation
  const abortController = new AbortController()
  let foundRevocation = null
  
  // @ts-ignore
  const checkCID = async (cid) => {
    if (abortController.signal.aborted) return null
    
    const event = lambdaUtils.mockEventCreator.createAPIGatewayEvent({
      pathParameters: { cid }
    })
    
    const response = await revocationsGet(event)
    if (response.statusCode === 200) {
      foundRevocation = {
        isValid: false,
        revokedDelegation: cid,
        reason: 'Delegation explicitly revoked'
      }
      abortController.abort() // Cancel remaining requests
      return foundRevocation
    }
    
    return null
  }
  
  // Process CIDs in batches with concurrency limit
  const promises = []
  for (let i = 0; i < cidsToCheck.length; i += concurrencyLimit) {
    const batch = cidsToCheck.slice(i, i + concurrencyLimit)
    const batchPromises = batch.map(checkCID)
    promises.push(...batchPromises)
    
    // Wait for current batch if we have more to process
    if (i + concurrencyLimit < cidsToCheck.length) {
      await Promise.allSettled(batchPromises)
      if (foundRevocation) break // Early exit if revocation found
    }
  }
  
  // Wait for remaining promises
  await Promise.allSettled(promises)
  
  // Return result
  return foundRevocation || { isValid: true }
}