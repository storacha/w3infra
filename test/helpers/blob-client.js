/**
 * @import * as UcantoAPI from '@ucanto/interface'
 * @import { InvocationConfig, Service } from '@storacha/upload-client/types'
 * @import { SpaceBlobAddSuccess, SpaceBlobAddFailure, BlobAllocateSuccess, BlobAllocateFailure, BlobAcceptSuccess, BlobAcceptFailure } from '@storacha/capabilities/types'
 */
import * as SpaceBlobCapabilities from '@storacha/capabilities/space/blob'
import * as BlobCapabilities from '@storacha/capabilities/blob'
import * as HTTPCapabilities from '@storacha/capabilities/http'
import * as UCANCapabilities from '@storacha/capabilities/ucan'
import { Receipt, isDelegation } from '@ucanto/core'
import { ed25519 } from '@ucanto/principal'
import { sha256 } from 'multiformats/hashes/sha2'
import { SpaceDID } from '@storacha/capabilities/utils'
import pRetry from 'p-retry'

// Blob custom client to be able to access receipts
// and enable a more internal testing

/**
 * @typedef {UcantoAPI.Receipt<SpaceBlobAddSuccess, SpaceBlobAddFailure>} SpaceBlobAddReceipt
 * @typedef {UcantoAPI.Receipt<BlobAllocateSuccess, BlobAllocateFailure>} BlobAllocateReceipt
 * @typedef {UcantoAPI.Receipt<BlobAcceptSuccess, BlobAcceptFailure>} BlobAcceptReceipt
 * @typedef {UcantoAPI.Receipt<{}, UcantoAPI.Failure> } HTTPPutReceipt
 */

/**
 * @param {InvocationConfig & { audience: UcantoAPI.Principal }} config
 * @param {Uint8Array} data
 * @param {{ connection: UcantoAPI.ConnectionView<Service>, retries?: number }} options
 */
export async function add(
  { issuer, with: resource, proofs, audience },
  data,
  options
) {
  // prepare data
  const multihash = await sha256.digest(data)
  const digest = multihash.bytes
  const size = data.byteLength

  const conn = options.connection
  const blobAddInvocation = SpaceBlobCapabilities.add
    .invoke({
      issuer,
      audience,
      with: SpaceDID.from(resource),
      nb: {
        blob: {
          digest,
          size,
        },
      },
      proofs,
    })
  const blobAddResult = await blobAddInvocation.execute(conn)
  if (!blobAddResult.out.ok) {
    console.error(blobAddResult.out.error)
    throw new Error(`failed ${SpaceBlobCapabilities.add.can} invocation`, {
      cause: blobAddResult.out.error,
    })
  }

  // Allocate if there is an address to allocate
  const next = parseBlobAddReceiptNext(blobAddResult)
  if (next.allocate.receipt.out.error) {
    console.error(next.allocate.receipt.out.error)
    throw new Error(`failed ${BlobCapabilities.allocate.can} invocation`, {
      cause: next.allocate.receipt.out.error
    })
  }

  const address = next.allocate.receipt.out.ok.address

  // Already is uploaded, so we should skip
  if (!address || next.accept.receipt || next.put.receipt) {
    return {
      multihash,
      next
    }
  }

  // Store the blob to the address
  const res = await pRetry(
    async () => {
      const res = await fetch(address.url, {
        method: 'PUT',
        mode: 'cors',
        body: /** @type {BodyInit} */ (data),
        headers: address.headers,
      })
      if (!res.ok) {
        throw new Error(`failed to PUT data, status: ${res.status}, body: ${await res.text()}`)
      }
      return res
    },
    {
      onFailedAttempt: console.warn,
      retries: options.retries ?? 5,
    }
  )

  if (!res.ok) {
    throw new Error(`upload failed: ${res.status}`)
  }

  // Create `http/put` receipt
  const keys = next.put.task.facts[0].keys
  // @ts-expect-error Argument of type 'unknown' is not assignable to parameter of type 'SignerArchive<`did:${string}:${string}`, SigAlg>'
  const blobProvider = ed25519.from(keys)

  const httpPut = HTTPCapabilities.put.invoke({
    issuer: blobProvider,
    audience: blobProvider,
    with: blobProvider.toDIDKey(),
    nb: {
      body: {
        digest,
        size,
      },
      url: {
        'ucan/await': ['.out.ok.address.url', next.allocate.task.link()],
      },
      headers: {
        'ucan/await': [
          '.out.ok.address.headers',
          next.allocate.task.link(),
        ],
      },
    },
    facts: next.put.task.facts,
    expiration: Infinity,
  })
  const httpPutDelegation = await httpPut.delegate()
  const httpPutReceipt = await Receipt.issue({
    issuer: blobProvider,
    ran: httpPutDelegation.cid,
    result: {
      ok: {},
    },
  })
  const httpPutConcludeInvocation = createConcludeInvocation(
    issuer,
    audience,
    httpPutReceipt
  )
  const ucanConclude = await httpPutConcludeInvocation.execute(conn)
  if (!ucanConclude.out.ok) {
    console.error(ucanConclude.out.error)
    throw new Error('invocation failed', { cause: ucanConclude.out.error })
  }

  return {
    multihash,
    next
  }
}

/**
 * @template {UcantoAPI.CapabilityParser<UcantoAPI.Match<UcantoAPI.ParsedCapability>>} C
 * @param {UcantoAPI.Invocation} invocation
 * @param {C} capability
 * @returns {invocation is UcantoAPI.Invocation<UcantoAPI.InferInvokedCapability<C>>}
 */
const isInvocation = (invocation, capability) => {
  const match = capability.match({
    // @ts-expect-error
    capability: invocation.capabilities[0],
    delegation: invocation,
  })
  return Boolean(match.ok)
}

/**
 * @param {SpaceBlobAddReceipt} receipt
 */
export function parseBlobAddReceiptNext(receipt) {
  /** @type {UcantoAPI.Invocation[]} */
  const forkInvocations = receipt.fx.fork.filter(f => isDelegation(f))
  
  const allocateTask = forkInvocations.find(f => isInvocation(f, BlobCapabilities.allocate))
  const concludefxs = forkInvocations.filter(f => isInvocation(f, UCANCapabilities.conclude))
  const putTask = forkInvocations.find(f => isInvocation(f, HTTPCapabilities.put))
  const acceptTask = forkInvocations.find(f => isInvocation(f, BlobCapabilities.accept))
  if (!allocateTask || !concludefxs.length || !putTask || !acceptTask) {
    console.error({ allocateTask: allocateTask?.cid, concludefxs: concludefxs[0]?.cid, putTask: putTask?.cid, acceptTask: acceptTask?.cid })
    throw new Error('mandatory effects not received')
  }

  // Decode receipts available
  const nextReceipts = concludefxs.map((fx) => getConcludeReceipt(fx))
  /** @type {BlobAllocateReceipt | undefined} */
  // @ts-expect-error types unknown for next
  const allocateReceipt = nextReceipts.find((receipt) =>
    receipt.ran.link().equals(allocateTask.cid)
  )
  /** @type {HTTPPutReceipt | undefined} */
  // @ts-expect-error types unknown for next
  const putReceipt = nextReceipts.find((receipt) =>
    receipt.ran.link().equals(putTask.cid)
  )
  /** @type {BlobAcceptReceipt | undefined} */
  // @ts-expect-error types unknown for next
  const acceptReceipt = nextReceipts.find((receipt) =>
    receipt.ran.link().equals(acceptTask.link())
  )

  if (!allocateReceipt) {
    throw new Error(`receipt not found for allocate task: ${allocateTask.cid}`)
  }

  return {
    allocate: {
      task: allocateTask,
      receipt: allocateReceipt,
    },
    put: {
      task: putTask,
      receipt: putReceipt,
    },
    accept: {
      task: acceptTask,
      receipt: acceptReceipt,
    },
  }
}

/**
 * @param {UcantoAPI.Invocation} concludeFx
 */
export function getConcludeReceipt(concludeFx) {
  const receiptBlocks = new Map()
  for (const block of concludeFx.iterateIPLDBlocks()) {
    receiptBlocks.set(`${block.cid}`, block)
  }
  return Receipt.view({
    // @ts-expect-error object of type unknown
    root: concludeFx.capabilities[0].nb.receipt,
    blocks: receiptBlocks,
  })
}

/**
 * @param {UcantoAPI.Signer} id
 * @param {UcantoAPI.Principal} serviceDid
 * @param {UcantoAPI.Receipt} receipt
 */
export function createConcludeInvocation(id, serviceDid, receipt) {
  const receiptBlocks = []
  const receiptCids = []
  for (const block of receipt.iterateIPLDBlocks()) {
    receiptBlocks.push(block)
    receiptCids.push(block.cid)
  }
  const concludeAllocatefx = UCANCapabilities.conclude.invoke({
    issuer: id,
    audience: serviceDid,
    with: id.toDIDKey(),
    nb: {
      receipt: receipt.link(),
    },
    expiration: Infinity,
    facts: [
      {
        ...receiptCids,
      },
    ],
  })
  for (const block of receiptBlocks) {
    concludeAllocatefx.attach(block)
  }

  return concludeAllocatefx
}
