import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import * as AgentMessage from '@web3-storage/upload-api/utils/agent-message'
import {
  RecordNotFound,
  StorageOperationFailed,
} from '@web3-storage/upload-api/errors'
import * as CAR from '@ucanto/transport/car'
import { CBOR, Invocation } from '@ucanto/core'
import * as API from '../types.js'

export { API }

/**
 * @typedef {import('@web3-storage/upload-api').AgentStore} AgentStore
 * @typedef {import('@aws-sdk/client-s3').ServiceInputTypes} ServiceInputTypes
 * @typedef {object} AgentStoreSettings
 * @property {string} region
 * @property {string} invocationBucketName
 * @property {string} taskBucketName
 * @property {string} workflowBucketName
 * @property {ServiceInputTypes} [options]
 *
 * @param {AgentStoreSettings} settings
 */
export const createAgentStore = (settings) => {
  return new AgentMessageStore({
    s3: new S3Client({ region: settings.region, ...settings.options }),
    settings,
  })
}

/**
 * @typedef {object} Connection
 * @property {S3Client} s3
 * @property {AgentStoreSettings} settings
 *
 * @implements {API.AgentStore}
 */
class AgentMessageStore {
  /**
   * @param {Connection} connection
   */
  constructor(connection) {
    this.connection = connection
    this.invocations = new InvocationsIndex(connection)
    this.receipts = new ReceiptsIndex(connection)
  }

  get messages() {
    return this
  }

  /**
   * @param {API.AgentMessage} message
   * @returns {Promise<API.Result<API.Unit, API.WriteError>>}
   */
  async write(message) {
    const { s3 } = this.connection
    const [...commands] = this.assert(message)
    try {
      await Promise.all(commands.map((command) => s3.send(command)))
      return { ok: {} }
    } catch (error) {
      return {
        error: new WriteError({
          cause: /** @type {Error} */ (error),
          writer: this,
          payload: message,
        }),
      }
    }
  }

  /**
   * @param {API.AgentMessage} message
   */
  *assert(message) {
    const { taskBucketName, invocationBucketName, workflowBucketName } =
      this.connection.settings
    const { body } = CAR.request.encode(message)
    const id = message.root.cid

    yield new PutObjectCommand({
      Bucket: workflowBucketName,
      Key: `${id}/${id}`,
      Body: body,
    })

    for (const { invocation, receipt } of AgentMessage.iterate(message)) {
      if (invocation) {
        // Store mapping for where each receipt lives in agent message file.
        // A pseudo symlink to `/${agentMessageArchive.cid}/${agentMessageArchive.cid}` via key
        // `${invocation.cid}/${agentMessageArchive.cid}`.in to track where each invocation lives
        // in a agent message file. As a pseudo symlink, it is an empty object.
        yield new PutObjectCommand({
          Bucket: invocationBucketName,
          Key: `${invocation.link()}/${id}.in`,
        })
      }

      if (receipt) {
        const invocationID = receipt.ran.link()
        // Store mapping for where each receipt lives in agent message file.
        // a pseudo symlink to `/${agentMessageArchive.cid}/${agentMessageArchive.cid}` via key
        // `${invocation.cid}/${agentMessageArchive.cid}.out` to track where each receipt lives
        // in a agent message file. As a pseudo symlink, it is an empty object.
        yield new PutObjectCommand({
          Bucket: invocationBucketName,
          Key: `${invocationID}/${id}.out`,
        })

        const taskID = receipt.ran.link()
        // Store mapping task to invocation
        // a pseudo symlink to `/${invocation.cid}/${invocation.cid}` via
        // `${task.cid}/${invocation.cid}.invocation` to enable looking up invocations and
        // receipts by a task. As a pseudo symlink, it is an empty object.
        yield new PutObjectCommand({
          Bucket: taskBucketName,
          Key: `${taskID}/${invocationID}.invocation`,
        })

        // Store receipt output
        // A block containing the out field of the receipt.
        const bytes = CBOR.encode({
          out: receipt.out,
        })

        yield new PutObjectCommand({
          Bucket: taskBucketName,
          Key: `${taskID}/${taskID}.result`,
          Body: bytes,
        })
      }
    }
  }
}

/**
 * @template T
 * @implements {API.WriteError<T>}
 */
class WriteError extends Error {
  name = /** @type {const} */ ('WriteError')
  /**
   * @param {object} input
   * @param {Error} input.cause
   * @param {T} input.payload
   * @param {API.Writer<T>} input.writer
   */
  constructor({ cause, payload, writer }) {
    super(`Write to store has failed: ${cause}`)
    this.cause = cause
    this.payload = payload
    this.writer = writer
  }
}

/**
 * @param {API.Variant<{invocation: API.UnknownLink, receipt: API.UnknownLink }>} key
 * @param {Connection} connection
 */
const resolveMessage = async ({ invocation, receipt }, { settings, s3 }) => {
  const [id, suffix] = invocation ? [invocation, '.in'] : [receipt, '.out']

  // Find agent message archive CID where this receipt was stored
  const encodedInvocationKeyPrefix = `${id}/`
  const listCmd = new ListObjectsV2Command({
    Bucket: settings.invocationBucketName,
    Prefix: encodedInvocationKeyPrefix,
  })

  let listRes
  try {
    listRes = await s3.send(listCmd)
  } catch (/** @type {any} */ error) {
    if (error?.$metadata?.httpStatusCode === 404) {
      return {
        error: new RecordNotFound(
          `any pseudo symlink from invocation ${id} was found`
        ),
      }
    }
    return {
      error: new StorageOperationFailed(error.message),
    }
  }
  if (!listRes.Contents?.length) {
    return {
      error: new RecordNotFound(
        `any pseudo symlink from invocation ${id} was found`
      ),
    }
  }

  // Key in format `${invocation.cid}/${agentMessageArchive.cid}.out`
  const agentMessageArchiveWithReceipt = listRes.Contents.find((c) =>
    c.Key?.endsWith(suffix)
  )
  if (!agentMessageArchiveWithReceipt || !agentMessageArchiveWithReceipt.Key) {
    return {
      error: new RecordNotFound(
        `any pseudo symlink from invocation ${id} was found with a receipt`
      ),
    }
  }

  // Get Message Archive with receipt
  const key = agentMessageArchiveWithReceipt.Key.replace(
    encodedInvocationKeyPrefix,
    ''
  ).replace(suffix, '')

  return { ok: `${key}/${key}` }
}
/**
 * @param {API.Variant<{invocation: API.UnknownLink, receipt: API.UnknownLink }>} key
 * @param {Connection} connection
 * @returns {Promise<API.Result<CAR.codec.Model, RecordNotFound|StorageOperationFailed>>}
 */
const getMessageArchive = async (key, connection) => {
  const { ok: path, error } = await resolveMessage(key, connection)

  if (error) {
    return { error }
  }

  const { ok: bytes, error: readError } = await readMessageArchive(
    path,
    connection
  )
  if (readError) {
    return { error: readError }
  }

  return { ok: await CAR.codec.decode(bytes) }
}

/**
 *
 * @param {string} path
 * @param {Connection} connection
 * @returns {Promise<API.Result<Uint8Array, RecordNotFound|StorageOperationFailed>>}
 */
const readMessageArchive = async (path, { settings, s3 }) => {
  const getCmd = new GetObjectCommand({
    Bucket: settings.workflowBucketName,
    Key: path,
  })

  let res
  try {
    res = await s3.send(getCmd)
  } catch (/** @type {any} */ error) {
    if (error?.$metadata?.httpStatusCode === 404) {
      return {
        error: new RecordNotFound(
          `agent message archive ${path} not found in store`
        ),
      }
    }
    return {
      error: new StorageOperationFailed(error.message),
    }
  }
  if (!res || !res.Body) {
    return {
      error: new RecordNotFound(
        `agent message archive ${path} not found in store`
      ),
    }
  }

  const bytes = await res.Body.transformToByteArray()

  return {
    ok: bytes,
  }
}

class InvocationsIndex {
  /**
   * @param {object} connection
   * @param {S3Client} connection.s3
   * @param {AgentStoreSettings} connection.settings
   */
  constructor(connection) {
    this.connection = connection
  }

  /**
   * @param {API.UnknownLink} task
   */
  async get(task) {
    const invocation = /** @type {API.UCANLink<[API.Capability]>} */ (task)
    const { ok: archive, error } = await getMessageArchive(
      { invocation },
      this.connection
    )

    if (error) {
      return { error }
    }

    const view = Invocation.view(
      {
        root: invocation,
        blocks: archive.blocks,
      },
      null
    )

    return view ? { ok: view } : { error: new RecordNotFound() }
  }
}

class ReceiptsIndex {
  /**
   * @param {object} connection
   * @param {S3Client} connection.s3
   * @param {AgentStoreSettings} connection.settings
   */
  constructor(connection) {
    this.connection = connection
  }

  /**
   * @param {import('@web3-storage/upload-api').UnknownLink} task
   * @returns
   */
  async get(task) {
    const invocation = /** @type {API.UCANLink<[API.Capability]>} */ (task)
    const { ok: path, error } = await resolveMessage(
      { receipt: invocation },
      this.connection
    )
    if (error) {
      return { error }
    }

    const { ok: body, error: readError } = await readMessageArchive(
      path,
      this.connection
    )
    if (readError) {
      return { error: readError }
    }

    const message = await CAR.request.decode({
      body,
      headers: {},
    })

    // Attempt to find a receipt corresponding to this task
    const id = invocation.toString()
    for (const { receipt } of AgentMessage.iterate(message)) {
      if (receipt && receipt.ran.link().toString() === id) {
        return { ok: receipt }
      }
    }

    return {
      error: new RecordNotFound(
        `agent message ${path} does not contain receipt for ${id} task`
      ),
    }
  }
}
