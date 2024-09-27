/**
 * Temporary stack for the old Pinning Service API (PSA) that maps root CIDs
 * to CAR files the complete DAGs are stored in.
 */
import { Function } from 'sst/constructs'

/** @param {import('sst/constructs').StackContext} context */
export function PSAStack ({ stack }) {
  stack.setDefaultFunctionProps({
    runtime: 'nodejs20.x',
    architecture: 'arm_64'
  })

  const hashFunction = new Function(stack, 'hash', {
    handler: 'shardutil/functions/hash.handler',
    url: { cors: true, authorizer: 'none' },
    memorySize: '4 GB',
    timeout: '15 minutes'
  })

  hashFunction.attachPermissions(['s3:GetObject'])

  const downloadFunction = new Function(stack, 'download', {
    handler: 'shardutil/functions/download.handler',
    url: { cors: true, authorizer: 'none' }
  })

  downloadFunction.attachPermissions(['s3:GetObject'])

  stack.addOutputs({
    hashFunctionURL: hashFunction.url,
    downloadFunctionURL: downloadFunction.url,
  })
}
