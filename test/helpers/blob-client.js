import * as BlobCapabilities from '@web3-storage/capabilities/blob'
import * as W3sBlobCapabilities from '@web3-storage/capabilities/web3.storage/blob'
import * as HTTPCapabilities from '@web3-storage/capabilities/http'
import * as UCANCapabilities from '@web3-storage/capabilities/ucan'
import { Receipt } from '@ucanto/core'
import { ed25519 } from '@ucanto/principal'
import { sha256 } from 'multiformats/hashes/sha2'
import { SpaceDID } from '@web3-storage/capabilities/utils'
import pRetry from 'p-retry'

/**
 * @typedef {import('@ucanto/interface').Failure} Failure
 * @typedef {import('@web3-storage/capabilities/types').BlobAddSuccess} BlobAddSuccess
 * @typedef {import('@web3-storage/capabilities/types').BlobAddFailure} BlobAddFailure
 * @typedef {import('@web3-storage/capabilities/types').BlobAllocateSuccess} BlobAllocateSuccess
 * @typedef {import('@web3-storage/capabilities/types').BlobAllocateFailure} BlobAllocateFailure
 * @typedef {import('@web3-storage/capabilities/types').BlobAcceptSuccess} BlobAcceptSuccess
 * @typedef {import('@web3-storage/capabilities/types').BlobAcceptFailure} BlobAcceptFailure
 * @typedef {import('@ucanto/interface').Receipt<BlobAddSuccess, BlobAddFailure> } BlobAddReceipt
 * @typedef {import('@ucanto/interface').Receipt<BlobAllocateSuccess, BlobAllocateFailure> } BlobAllocateReceipt
 * @typedef {import('@ucanto/interface').Receipt<BlobAcceptSuccess, BlobAcceptFailure> } BlobAcceptReceipt
 * @typedef {import('@ucanto/interface').Receipt<{}, Failure> } HTTPPutReceipt
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
  const blobAddInvocation = BlobCapabilities.add
    .invoke({
      issuer,
      /* c8 ignore next */
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
  const blobAddresult = await blobAddInvocation.execute(conn)

  if (!blobAddresult.out.ok) {
    throw new Error(`failed ${BlobCapabilities.add.can} invocation`, {
      cause: blobAddresult.out.error,
    })
  }

  // Alocate if there is an address to allocate
  const next = parseBlobAddReceiptNext(blobAddresult)
  /** @type {import('@web3-storage/capabilities/types').BlobAddress} */
  // @ts-expect-error receipt type is unknown
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
        body: data,
        headers: address.headers,
      })
      
      if (res.status !== 200) {
        throw new Error('failed to PUT data')
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
    throw new Error('invocation failed', { cause: ucanConclude.out.error })
  }

  return {
    multihash,
    next
  }
}

/**
 * @param {import('@ucanto/interface').Receipt} receipt
 */
export function parseBlobAddReceiptNext(receipt) {
  // Get invocations next
  /**
   * @type {import('@ucanto/interface').Invocation[]}
   **/
  // @ts-expect-error read only effect
  const forkInvocations = receipt.fx.fork
  const allocateTask = forkInvocations.find(
    (fork) => fork.capabilities[0].can === W3sBlobCapabilities.allocate.can
  )
  const concludefxs = forkInvocations.filter(
    (fork) => fork.capabilities[0].can === UCANCapabilities.conclude.can
  )
  const putTask = forkInvocations.find(
    (fork) => fork.capabilities[0].can === HTTPCapabilities.put.can
  )
  const acceptTask = receipt.fx.join
  if (!allocateTask || !concludefxs.length || !putTask || !acceptTask) {
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
    throw new Error('mandatory effects not received')
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
 * @param {import('@ucanto/interface').Invocation} concludeFx
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
 * @param {import('@ucanto/interface').Signer} id
 * @param {import('@ucanto/interface').Verifier} serviceDid
 * @param {import('@ucanto/interface').Receipt} receipt
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
