import { invoke, delegate, Receipt, API, Message } from '@ucanto/core'
import * as CAR from '@ucanto/transport/car'
import * as Signer from '@ucanto/principal/ed25519'
import * as UcantoClient from '@ucanto/client'

import { connect, createServer } from '@web3-storage/upload-api';
import { DebugEmail } from '@web3-storage/upload-api/test';
import {
  createBucket,
  createTable
} from '../helpers/resources.js';
import { storeTableProps, uploadTableProps, consumerTableProps, delegationTableProps, subscriptionTableProps, rateLimitTableProps, revocationTableProps } from '../../tables/index.js';
import { useCarStore } from '../../buckets/car-store.js';
import { useDudewhereStore } from '../../buckets/dudewhere-store.js';
import { useStoreTable } from '../../tables/store.js';
import { useUploadTable } from '../../tables/upload.js';
import { useProvisionStore } from '../../stores/provisions.js';
import { useConsumerTable } from '../../tables/consumer.js';
import { useSubscriptionTable } from '../../tables/subscription.js';
import { useDelegationsTable } from '../../tables/delegations.js';
import { useRevocationsTable } from '../../stores/revocations.js';
import { useDelegationsStore } from '../../buckets/delegations-store.js';
import { useInvocationStore } from '../../buckets/invocation-store.js';
import { useWorkflowStore } from '../../buckets/workflow-store.js';
import { useRateLimitTable } from '../../tables/rate-limit.js';
import { useSpaceMetricsTable } from '../../tables/space-metrics.js';
import { spaceMetricsTableProps } from '@web3-storage/w3infra-ucan-invocation/tables/index.js';
import { createCustomerStore, customerTableProps } from '@web3-storage/w3infra-billing/tables/customer.js';
import { usePlansStore } from '../../stores/plans.js';
import { pieceTableProps } from '../../../filecoin/store/index.js';
import { usePieceTable } from '../../../filecoin/store/piece.js'
import { createTaskStore as createFilecoinTaskStore } from '../../../filecoin/store/task.js'
import { createReceiptStore as createFilecoinReceiptStore } from '../../../filecoin/store/receipt.js'

export { API }

/**
 * @param {API.Principal} audience
 */
export async function createSpace(audience) {
  const space = await Signer.generate()
  const spaceDid = space.did()

  return {
    proof: await UcantoClient.delegate({
      issuer: space,
      audience,
      capabilities: [{ can: '*', with: spaceDid }],
    }),
    spaceDid,
  }
}

/**
 * @param {API.Ability} can
 * @param {any} nb
 * @param {object} [options]
 * @param {Signer.EdSigner} [options.audience]
 * @param {Signer.EdSigner} [options.issuer]
 * @param {`did:key:${string}`} [options.withDid]
 * @param {Signer.Delegation[]} [options.proofs]
 */
export async function createUcanInvocation(can, nb, options = {}) {
  const audience = options.audience || (await Signer.generate())
  const issuer = options.issuer || (await Signer.generate())

  let proofs
  let withDid
  if (!options.withDid || !options.proofs) {
    const { proof, spaceDid } = await createSpace(issuer)

    proofs = [proof]
    withDid = spaceDid
  } else {
    proofs = options.proofs
    withDid = options.withDid
  }

  return await delegate({
    issuer,
    audience,
    capabilities: [
      {
        can,
        with: withDid,
        nb,
      },
    ],
    proofs,
  })
}

/**
 * Create an invocation with given capabilities.
 *
 * @param {API.Ability} can
 * @param {any} nb
 * @param {object} [options]
 * @param {Signer.EdSigner} [options.audience]
 * @param {Signer.EdSigner} [options.issuer]
 * @param {`did:key:${string}`} [options.withDid]
 * @param {Signer.Delegation[]} [options.proofs]
 */
export async function createInvocation(can, nb, options = {}) {
  const audience = options.audience || (await Signer.generate())
  const issuer = options.issuer || (await Signer.generate())

  let proofs
  let withDid
  if (!options.withDid || !options.proofs) {
    const { proof, spaceDid } = await createSpace(issuer)

    proofs = [proof]
    withDid = spaceDid
  } else {
    proofs = options.proofs
    withDid = options.withDid
  }

  const invocation = invoke({
    issuer,
    audience,
    capability: {
      can,
      with: withDid,
      nb,
    },
    proofs,
  })

  return invocation
}

/**
 * @param {API.IssuedInvocation} run
 * @param {object} options
 * @param {any} [options.result]
 * @param {any} [options.meta]
 */
export async function createAgentMessageReceipt(
  run,
  { result = { ok: {} }, meta = { test: 'metadata' } }
) {
  const delegation = await run.buildIPLDView()

  return await Receipt.issue({
    // @ts-ignore Mismatch between types for Principal and Signer
    issuer: run.audience,
    result,
    ran: delegation.link(),
    meta,
    fx: {
      fork: [],
    },
  })
}

/**
 * @param {object} source
 * @param {API.IssuedInvocation[]} [source.invocations]
 * @param {API.Receipt[]} [source.receipts]
 */
export const encodeAgentMessage = async (source) => {
  const message = await Message.build({
    invocations: /** @type {API.Tuple<API.IssuedInvocation>} */ (
      source.invocations
    ),
    receipts: /** @type {API.Tuple<API.Receipt>} */ (source.receipts),
  })

  return await CAR.request.encode(message)
}


/**
 *
 * @param {import('ava').ExecutionContext} t
 * @returns {Promise<import('@web3-storage/upload-api').UcantoServerTestContext>}
 */

export async function executionContextToUcantoTestServerContext(t) {
  const service = Signer.Signer.parse('MgCYWjE6vp0cn3amPan2xPO+f6EZ3I+KwuN1w2vx57vpJ9O0Bn4ci4jn8itwc121ujm7lDHkCW24LuKfZwIdmsifVysY=').withDID(
    'did:web:test.web3.storage'
  );
  const { dynamo, s3 } = t.context;
  const bucketName = await createBucket(s3);

  const storeTable = useStoreTable(
    dynamo,
    await createTable(dynamo, storeTableProps)
  );

  const uploadTable = useUploadTable(
    dynamo,
    await createTable(dynamo, uploadTableProps)
  );
  const carStoreBucket = useCarStore(s3, bucketName);

  const dudewhereBucket = useDudewhereStore(s3, bucketName);

  const signer = await Signer.Signer.generate();
  const id = signer.withDID('did:web:test.web3.storage');
  const aggregatorSigner = await Signer.Signer.generate();

  const delegationsBucketName = await createBucket(s3);
  const invocationsBucketName = await createBucket(s3);
  const workflowBucketName = await createBucket(s3);

  const revocationsStorage = useRevocationsTable(
    dynamo,
    await createTable(dynamo, revocationTableProps)
  )
  const delegationsStorage = useDelegationsTable(
    dynamo,
    await createTable(dynamo, delegationTableProps),
    {
      bucket: useDelegationsStore(s3, delegationsBucketName),
      invocationBucket: useInvocationStore(s3, invocationsBucketName),
      workflowBucket: useWorkflowStore(s3, workflowBucketName),
    }
  );
  const rateLimitsStorage = useRateLimitTable(
    dynamo,
    await createTable(dynamo, rateLimitTableProps)
  )
  const subscriptionTable = useSubscriptionTable(
    dynamo,
    await createTable(dynamo, subscriptionTableProps)
  );
  const consumerTable = useConsumerTable(
    dynamo,
    await createTable(dynamo, consumerTableProps)
  );
  const spaceMetricsTable = useSpaceMetricsTable(
    dynamo,
    await createTable(dynamo, spaceMetricsTableProps)
  )
  const pieceStore = usePieceTable(
    dynamo,
    await createTable(dynamo, pieceTableProps)
  )
  const provisionsStorage = useProvisionStore(
    subscriptionTable,
    consumerTable,
    spaceMetricsTable,
    [service.did()]
  );
  const customersStore = createCustomerStore(dynamo, { tableName: await createTable(dynamo, customerTableProps) })
  const plansStorage = usePlansStore(customersStore)
  const email = new DebugEmail();

  /** @type {import('@web3-storage/upload-api').UcantoServerContext} */
  const serviceContext = {
    id,
    signer: id,
    email,
    url: new URL('http://example.com'),
    provisionsStorage,
    delegationsStorage,
    rateLimitsStorage,
    revocationsStorage,
    plansStorage,
    errorReporter: {
      catch (error) {
        t.fail(error.message);
      },
    },
    maxUploadSize: 5_000_000_000,
    storeTable,
    uploadTable,
    carStoreBucket,
    dudewhereBucket,
    validateAuthorization: () => ({ ok: {} }),
    // filecoin/*
    aggregatorId: aggregatorSigner,
    pieceStore,
    taskStore: createFilecoinTaskStore(s3, invocationsBucketName, workflowBucketName),
    receiptStore: createFilecoinReceiptStore(s3, invocationsBucketName, workflowBucketName),
    // @ts-expect-error not tested here
    pieceOfferQueue: {},
    // @ts-expect-error not tested here
    filecoinSubmitQueue: {},
    options: {
      // TODO: we compute and put all pieces into the queue on bucket event
      // We may change this to validate user provided piece
      skipFilecoinSubmitQueue: true
    },
  };
  const connection = connect({
    id: serviceContext.id,
    channel: createServer(serviceContext)
  });


  return {
    ...serviceContext,
    mail: email,
    service: id,
    connection,
    fetch
  };
}
