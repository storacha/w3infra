import { createRequire as topLevelCreateRequire } from 'module';const require = topLevelCreateRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));

// sst.config.ts
import { Tags, RemovalPolicy as RemovalPolicy2 } from "aws-cdk-lib";
import path from "node:path";

// stacks/billing-stack.js
import { use, Cron, Queue, Function, Config as Config3, Api } from "sst/constructs";
import { FilterCriteria, FilterRule, StartingPosition as StartingPosition2 } from "aws-cdk-lib/aws-lambda";
import { SqsDlq } from "aws-cdk-lib/aws-lambda-event-sources";
import { Duration as Duration2 } from "aws-cdk-lib";

// stacks/ucan-invocation-stack.js
import {
  Bucket,
  KinesisStream
} from "sst/constructs";
import { PolicyStatement, StarPrincipal, Effect } from "aws-cdk-lib/aws-iam";

// stacks/config.js
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { createRequire } from "module";
import { StartingPosition } from "aws-cdk-lib/aws-lambda";
import git from "git-rev-sync";

// lib/env.js
var mustGetEnv = /* @__PURE__ */ __name((name) => {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing env var: ${name}`);
  return value;
}, "mustGetEnv");

// stacks/config.js
function getBucketName(name, stage, app, version = 0) {
  if (app === "w3infra") {
    return `${name}-${stage}-${version}`;
  }
  return `${stage}-${app}-${name}-${version}`;
}
__name(getBucketName, "getBucketName");
function getCdkNames(name, stage, app, version = 0) {
  return `${stage}-${app}-${name}-${version}`;
}
__name(getCdkNames, "getCdkNames");
function isProd(stage) {
  if (!stage)
    throw new Error("stage must be provided");
  return stage.startsWith("prod-") || stage === "prod" || stage.endsWith("-prod");
}
__name(isProd, "isProd");
function isStaging(stage) {
  if (!stage)
    throw new Error("stage must be provided");
  return stage.startsWith("staging-") || stage === "staging" || stage.endsWith("-staging");
}
__name(isStaging, "isStaging");
function isPrBuild(stage) {
  if (!stage)
    throw new Error("stage must be provided");
  return !isProd(stage) && !isStaging(stage);
}
__name(isPrBuild, "isPrBuild");
function getBucketConfig(name, stage, app, version = 0) {
  return {
    bucketName: getBucketName(name, stage, app, version),
    ...isPrBuild(stage) && {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY
    }
  };
}
__name(getBucketConfig, "getBucketConfig");
function getCustomDomain(stage, hostedZone) {
  if (!hostedZone) {
    return;
  }
  const domainMap = { prod: hostedZone };
  const domainName = domainMap[stage] ?? `${stage}.${hostedZone}`;
  return { domainName, hostedZone };
}
__name(getCustomDomain, "getCustomDomain");
function getEventSourceConfig(stack) {
  if (!isProd(stack.stage)) {
    return {
      batchSize: 10,
      // The maximum amount of time to gather records before invoking the function.
      maxBatchingWindow: Duration.seconds(5),
      // If the function returns an error, split the batch in two and retry.
      bisectBatchOnError: true,
      // Where to begin consuming the stream.
      startingPosition: StartingPosition.LATEST
    };
  }
  return {
    // Dynamo Transactions allow up to 100 writes per transactions. If we allow 10 capabilities executed per request, we can have up to 100.
    // TODO: we use bisectBatchOnError, so maybe we can attempt bigger batch sizes to be optimistic?
    batchSize: 10,
    // The maximum amount of time to gather records before invoking the function.
    maxBatchingWindow: Duration.minutes(2),
    // If the function returns an error, split the batch in two and retry.
    bisectBatchOnError: true,
    // Where to begin consuming the stream.
    startingPosition: StartingPosition.TRIM_HORIZON
  };
}
__name(getEventSourceConfig, "getEventSourceConfig");
function getKinesisStreamConfig(stack) {
  if (!isProd(stack.stage) && !isStaging(stack.stage)) {
    return {
      retentionPeriod: Duration.hours(24)
    };
  }
  return {
    retentionPeriod: Duration.days(365)
  };
}
__name(getKinesisStreamConfig, "getKinesisStreamConfig");
function getApiPackageJson() {
  const require2 = createRequire(import.meta.url);
  try {
    return require2("./upload-api/package.json");
  } catch {
    return require2("../upload-api/package.json");
  }
}
__name(getApiPackageJson, "getApiPackageJson");
function getGitInfo() {
  return {
    commmit: git.long("."),
    branch: git.branch(".")
  };
}
__name(getGitInfo, "getGitInfo");
function setupSentry(app, stack) {
  if (app.local) {
    return;
  }
  const { SENTRY_DSN } = getEnv();
  stack.addDefaultFunctionEnv({
    SENTRY_DSN
  });
}
__name(setupSentry, "setupSentry");
function getServiceURL(stack, customDomain) {
  return customDomain ? `https://${customDomain.domainName}` : process.env.ACCESS_SERVICE_URL;
}
__name(getServiceURL, "getServiceURL");
function getEnv() {
  return {
    SENTRY_DSN: mustGetEnv("SENTRY_DSN"),
    UPLOAD_API_DID: mustGetEnv("UPLOAD_API_DID"),
    AGGREGATOR_DID: mustGetEnv("AGGREGATOR_DID"),
    AGGREGATOR_URL: mustGetEnv("AGGREGATOR_URL"),
    INDEXING_SERVICE_DID: mustGetEnv("INDEXING_SERVICE_DID"),
    INDEXING_SERVICE_URL: mustGetEnv("INDEXING_SERVICE_URL"),
    /** @deprecated */
    CONTENT_CLAIMS_DID: mustGetEnv("CONTENT_CLAIMS_DID"),
    /** @deprecated */
    CONTENT_CLAIMS_URL: mustGetEnv("CONTENT_CLAIMS_URL"),
    EIPFS_MULTIHASHES_SQS_ARN: mustGetEnv("EIPFS_MULTIHASHES_SQS_ARN"),
    EIPFS_BLOCKS_CAR_POSITION_TABLE_ARN: mustGetEnv("EIPFS_BLOCKS_CAR_POSITION_TABLE_ARN"),
    // Not required
    STOREFRONT_PROOF: process.env.STOREFRONT_PROOF ?? "",
    DISABLE_PIECE_CID_COMPUTE: process.env.DISABLE_PIECE_CID_COMPUTE ?? "",
    START_FILECOIN_METRICS_EPOCH_MS: process.env.START_FILECOIN_METRICS_EPOCH_MS ?? "",
    DISABLE_IPNI_PUBLISHING: process.env.DISABLE_IPNI_PUBLISHING ?? ""
  };
}
__name(getEnv, "getEnv");

// stacks/ucan-invocation-stack.js
function UcanInvocationStack({ stack, app }) {
  setupSentry(app, stack);
  const agentMessageBucket = new Bucket(stack, "workflow-store", {
    cors: true,
    cdk: {
      bucket: {
        ...getBucketConfig("workflow-store", app.stage, app.name),
        // change the defaults accordingly to allow access via new Policy
        blockPublicAccess: {
          blockPublicAcls: true,
          ignorePublicAcls: true,
          restrictPublicBuckets: false,
          blockPublicPolicy: false
        }
      }
    }
  });
  agentMessageBucket.cdk.bucket.addToResourcePolicy(
    new PolicyStatement({
      actions: ["s3:GetObject"],
      effect: Effect.ALLOW,
      principals: [new StarPrincipal()],
      resources: [agentMessageBucket.cdk.bucket.arnForObjects("*")]
    })
  );
  const agentIndexBucket = new Bucket(stack, "invocation-store", {
    cors: true,
    cdk: {
      bucket: getBucketConfig("invocation-store", app.stage, app.name)
    }
  });
  new Bucket(stack, "ucan-store", {
    cors: true,
    cdk: {
      bucket: getBucketConfig("ucan-store", app.stage, app.name)
    }
  });
  if (stack.stage === "production" || stack.stage === "staging") {
    new KinesisStream(stack, "ucan-stream", {
      cdk: {
        stream: getKinesisStreamConfig(stack)
      }
    });
  }
  const ucanStream = new KinesisStream(stack, "ucan-stream-v2", {
    cdk: {
      stream: getKinesisStreamConfig(stack)
    }
  });
  stack.addOutputs({
    agentMessageBucketName: agentMessageBucket.bucketName,
    agentIndexBucketName: agentIndexBucket.bucketName
  });
  return {
    agentIndexBucket,
    agentMessageBucket,
    ucanStream
  };
}
__name(UcanInvocationStack, "UcanInvocationStack");

// stacks/billing-db-stack.js
import { Table, Config } from "sst/constructs";

// billing/tables/client.js
import { BatchWriteItemCommand, DynamoDBClient as DynamoDBClient2, GetItemCommand, PutItemCommand, QueryCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall, convertToAttr } from "@aws-sdk/util-dynamodb";
import retry from "p-retry";

// node_modules/.pnpm/@ucanto+server@11.0.3/node_modules/@ucanto/server/src/lib.js
var lib_exports = {};
__export(lib_exports, {
  API: () => api_exports,
  DID: () => DID,
  Delegation: () => Delegation,
  Error: () => error_exports,
  Failure: () => Failure3,
  Invocation: () => Invocation,
  Link: () => Link,
  Receipt: () => Receipt2,
  Schema: () => Schema2,
  Signature: () => Signature,
  URI: () => URI,
  access: () => access2,
  capability: () => capability,
  claim: () => claim,
  create: () => create,
  error: () => error,
  execute: () => execute,
  fail: () => fail,
  handle: () => handle,
  invoke: () => invoke2,
  ok: () => ok,
  provide: () => provide,
  provideAdvanced: () => provideAdvanced,
  resolve: () => resolve,
  run: () => run
});

// node_modules/.pnpm/@ucanto+server@11.0.3/node_modules/@ucanto/server/src/api.js
var api_exports = {};

// node_modules/.pnpm/@ucanto+server@11.0.3/node_modules/@ucanto/server/src/lib.js
__reExport(lib_exports, core_star);
import * as core_star from "@ucanto/core";

// node_modules/.pnpm/@ucanto+server@11.0.3/node_modules/@ucanto/server/src/server.js
import * as API2 from "@ucanto/interface";
import { Verifier } from "@ucanto/principal";
import { capability, URI, Link, Failure as Failure3 } from "@ucanto/validator";
import { Receipt, Message, fail } from "@ucanto/core";

// node_modules/.pnpm/@ucanto+server@11.0.3/node_modules/@ucanto/server/src/error.js
var error_exports = {};
__export(error_exports, {
  HandlerExecutionError: () => HandlerExecutionError,
  HandlerNotFound: () => HandlerNotFound,
  InvocationCapabilityError: () => InvocationCapabilityError,
  MalformedCapability: () => MalformedCapability
});
import * as API from "@ucanto/interface";
import { Failure } from "@ucanto/core";
import { MalformedCapability } from "@ucanto/validator";
var HandlerNotFound = class extends RangeError {
  static {
    __name(this, "HandlerNotFound");
  }
  /**
   * @param {API.Capability} capability
   */
  constructor(capability2) {
    super();
    this.error = true;
    this.capability = capability2;
  }
  /** @type {'HandlerNotFound'} */
  get name() {
    return "HandlerNotFound";
  }
  get message() {
    return `service does not implement {can: "${this.capability.can}"} handler`;
  }
  toJSON() {
    return {
      name: this.name,
      error: this.error,
      capability: {
        can: this.capability.can,
        with: this.capability.with
      },
      message: this.message,
      stack: this.stack
    };
  }
};
var HandlerExecutionError = class extends Failure {
  static {
    __name(this, "HandlerExecutionError");
  }
  /**
   * @param {API.Capability} capability
   * @param {Error} cause
   */
  constructor(capability2, cause) {
    super();
    this.capability = capability2;
    this.cause = cause;
    this.error = true;
  }
  /** @type {'HandlerExecutionError'} */
  get name() {
    return "HandlerExecutionError";
  }
  get message() {
    return `service handler {can: "${this.capability.can}"} error: ${this.cause.message}`;
  }
  toJSON() {
    return {
      name: this.name,
      error: this.error,
      capability: {
        can: this.capability.can,
        with: this.capability.with
      },
      cause: {
        ...this.cause,
        name: this.cause.name,
        message: this.cause.message,
        stack: this.cause.stack
      },
      message: this.message,
      stack: this.stack
    };
  }
};
var InvocationCapabilityError = class extends Error {
  static {
    __name(this, "InvocationCapabilityError");
  }
  /**
   * @param {any} caps
   */
  constructor(caps) {
    super();
    this.error = true;
    this.caps = caps;
  }
  get name() {
    return "InvocationCapabilityError";
  }
  get message() {
    return `Invocation is required to have a single capability.`;
  }
  toJSON() {
    return {
      name: this.name,
      error: this.error,
      message: this.message,
      capabilities: this.caps
    };
  }
};

// node_modules/.pnpm/@ucanto+server@11.0.3/node_modules/@ucanto/server/src/handler.js
import { access, Schema, Failure as Failure2 } from "@ucanto/validator";
var provide = /* @__PURE__ */ __name((capability2, handler) => provideAdvanced({ capability: capability2, handler }), "provide");
var provideAdvanced = /* @__PURE__ */ __name(({ capability: capability2, handler, audience }) => (
  /**
   * @param {API.Invocation<API.Capability<A, R, C>>} invocation
   * @param {API.InvocationContext} options
   */
  async (invocation, options) => {
    const audienceSchema = audience || options.audience || Schema.literal(options.id.did());
    const result = audienceSchema.read(invocation.audience.did());
    if (result.error) {
      return { error: new InvalidAudience({ cause: result.error }) };
    }
    const authorization = await access(invocation, {
      ...options,
      authority: options.id,
      capability: capability2
    });
    if (authorization.error) {
      return authorization;
    } else {
      return handler({
        capability: authorization.ok.capability,
        invocation,
        context: options
      });
    }
  }
), "provideAdvanced");
var InvalidAudience = class extends Failure2 {
  static {
    __name(this, "InvalidAudience");
  }
  /**
   * @param {object} source
   * @param {API.Failure} source.cause
   */
  constructor({ cause }) {
    super();
    this.name = /** @type {const} */
    "InvalidAudience";
    this.cause = cause;
  }
  describe() {
    return this.cause.message;
  }
};
var Ok = class {
  static {
    __name(this, "Ok");
  }
  /**
   * @param {T} ok
   */
  constructor(ok2) {
    this.ok = ok2;
  }
  get result() {
    return { ok: this.ok };
  }
  get effects() {
    return { fork: [] };
  }
  /**
   * @param {API.Run} run
   * @returns {API.ForkBuilder<T, X>}
   */
  fork(run2) {
    return new Fork({
      out: this.result,
      fx: {
        fork: [run2]
      }
    });
  }
  /**
   * @param {API.Run} run
   * @returns {API.JoinBuilder<T, X>}
   */
  join(run2) {
    return new Join({
      out: this.result,
      fx: {
        fork: [],
        join: run2
      }
    });
  }
};
var Error2 = class {
  static {
    __name(this, "Error");
  }
  /**
   * @param {X} error
   */
  constructor(error2) {
    this.error = error2;
  }
  get result() {
    return { error: this.error };
  }
  get effects() {
    return { fork: [] };
  }
  /**
   * @param {API.Run} run
   * @returns {API.ForkBuilder<T, X>}
   */
  fork(run2) {
    return new Fork({
      out: this.result,
      fx: {
        fork: [run2]
      }
    });
  }
  /**
   * @param {API.Run} run
   * @returns {API.JoinBuilder<T, X>}
   */
  join(run2) {
    return new Join({
      out: this.result,
      fx: {
        fork: [],
        join: run2
      }
    });
  }
};
var Join = class _Join {
  static {
    __name(this, "Join");
  }
  /**
   * @param {API.Do<T, X>} model
   */
  constructor(model) {
    this.do = model;
  }
  get result() {
    return this.do.out;
  }
  get effects() {
    return this.do.fx;
  }
  /**
   * @param {API.Run} run
   * @returns {API.JoinBuilder<T, X>}
   */
  fork(run2) {
    const { out, fx } = this.do;
    return new _Join({
      out,
      fx: {
        ...fx,
        fork: [...fx.fork, run2]
      }
    });
  }
};
var Fork = class _Fork extends Join {
  static {
    __name(this, "Fork");
  }
  /**
   * @param {API.Run} run
   * @returns {API.JoinBuilder<T, X>}
   */
  join(run2) {
    const { out, fx } = this.do;
    return new Join({
      out,
      fx: { ...fx, join: run2 }
    });
  }
  /**
   * @param {API.Run} run
   * @returns {API.ForkBuilder<T, X>}
   */
  fork(run2) {
    const { out, fx } = this.do;
    return new _Fork({
      out,
      fx: { ...fx, fork: [...fx.fork, run2] }
    });
  }
};
var ok = /* @__PURE__ */ __name((value) => new Ok(value), "ok");
var error = /* @__PURE__ */ __name((error2) => new Error2(error2), "error");

// node_modules/.pnpm/@ucanto+server@11.0.3/node_modules/@ucanto/server/src/server.js
var create = /* @__PURE__ */ __name((options) => new Server(options), "create");
var Server = class {
  static {
    __name(this, "Server");
  }
  /**
   * @param {API.ServerOptions<S>} options
   */
  constructor({ id, service, codec, principal = Verifier, ...rest }) {
    const { catch: fail2, ...context } = rest;
    this.context = { id, principal, ...context };
    this.service = service;
    this.codec = codec;
    this.catch = fail2 || (() => {
    });
    this.validateAuthorization = this.context.validateAuthorization.bind(
      this.context
    );
  }
  get id() {
    return this.context.id;
  }
  /**
   * @template {API.Tuple<API.ServiceInvocation<API.Capability, S>>} I
   * @param {API.HTTPRequest<API.AgentMessage<{ In: API.InferInvocations<I>, Out: API.Tuple<API.Receipt> }>>} request
   * @returns {Promise<API.HTTPResponse<API.AgentMessage<{ Out: API.InferReceipts<I, S>, In: API.Tuple<API.Invocation> }>>>}
   */
  request(request) {
    return handle(this, request);
  }
  /**
   * @template {API.Capability} C
   * @param {API.ServiceInvocation<C, S>} invocation
   * @returns {Promise<API.InferReceipt<C, S>>}
   */
  async run(invocation) {
    const receipt = (
      /** @type {API.InferReceipt<C, S>} */
      await invoke(await invocation.buildIPLDView(), this)
    );
    return receipt;
  }
};
var handle = /* @__PURE__ */ __name(async (server, request) => {
  const selection = server.codec.accept(request);
  if (selection.error) {
    const { status, headers = {}, message } = selection.error;
    return {
      status,
      headers,
      body: new TextEncoder().encode(message)
    };
  } else {
    const { encoder, decoder } = selection.ok;
    let message;
    try {
      message = await decoder.decode(request);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unable to decode request";
      return {
        status: 400,
        headers: { "Content-Type": "text/plain" },
        body: new TextEncoder().encode(`Bad request: Malformed payload - ${errorMessage}`)
      };
    }
    const result = await execute(message, server);
    const response = await encoder.encode(result);
    return response;
  }
}, "handle");
var execute = /* @__PURE__ */ __name(async (input, server) => {
  const promises = input.invocations.map(($) => run($, server));
  const receipts = (
    /** @type {API.InferReceipts<I, S>} */
    await Promise.all(promises)
  );
  return Message.build({ receipts });
}, "execute");
var run = /* @__PURE__ */ __name(async (invocation, server) => {
  if (invocation.capabilities.length !== 1) {
    return await Receipt.issue({
      issuer: server.id,
      ran: invocation,
      result: {
        error: new InvocationCapabilityError(invocation.capabilities)
      }
    });
  }
  const [capability2] = invocation.capabilities;
  const path2 = capability2.can.split("/");
  const method = (
    /** @type {string} */
    path2.pop()
  );
  const handler = resolve(server.service, path2);
  if (handler == null || typeof handler[method] !== "function") {
    return await Receipt.issue({
      issuer: server.id,
      ran: invocation,
      result: {
        /** @type {API.HandlerNotFound} */
        error: new HandlerNotFound(capability2)
      }
    });
  } else {
    try {
      const outcome = await handler[method](invocation, server.context);
      const result = outcome.do ? outcome.do.out : outcome;
      const fx = outcome.do ? outcome.do.fx : void 0;
      return await Receipt.issue({
        issuer: server.id,
        ran: invocation,
        result,
        fx
      });
    } catch (cause) {
      const error2 = new HandlerExecutionError(
        capability2,
        /** @type {Error} */
        cause
      );
      server.catch(error2);
      return await Receipt.issue({
        issuer: server.id,
        ran: invocation,
        result: { error: error2 }
      });
    }
  }
}, "run");
var invoke = run;
var resolve = /* @__PURE__ */ __name((service, path2) => {
  let target = service;
  for (const key of path2) {
    target = target[key];
    if (!target) {
      return null;
    }
  }
  return target;
}, "resolve");

// node_modules/.pnpm/@ucanto+server@11.0.3/node_modules/@ucanto/server/src/lib.js
import {
  invoke as invoke2,
  Invocation,
  Receipt as Receipt2,
  Delegation,
  DID,
  Signature
} from "@ucanto/core";
import { access as access2, claim, Schema as Schema2 } from "@ucanto/validator";

// lib/aws/dynamo.js
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

// billing/data/lib.js
import * as Validator from "@ucanto/validator";
var BigIntSchema = class extends Validator.Schema.API {
  static {
    __name(this, "BigIntSchema");
  }
  /**
   * @param {I} input
   */
  readWith(input) {
    return typeof input === "bigint" ? { ok: input } : Validator.typeError({ expect: "bigint", actual: input });
  }
  toString() {
    return "bigint";
  }
  /**
   * @param {bigint} n
   */
  greaterThanEqualTo(n) {
    return this.refine(new GreaterThanEqualTo(n));
  }
};
var GreaterThanEqualTo = class extends Validator.Schema.API {
  static {
    __name(this, "GreaterThanEqualTo");
  }
  /**
   * @param {T} input
   * @param {bigint} number
   * @returns {Validator.Schema.ReadResult<T>}
   */
  readWith(input, number) {
    return input >= number ? { ok: input } : Validator.Schema.error(`Expected ${input} >= ${number}`);
  }
  toString() {
    return `greaterThan(${this.settings})`;
  }
};
var DateSchema = class extends Validator.Schema.API {
  static {
    __name(this, "DateSchema");
  }
  /**
   * @param {I} input
   */
  readWith(input) {
    return input instanceof Date ? { ok: input } : Validator.typeError({ expect: "Date", actual: input });
  }
  toString() {
    return "Date";
  }
};
var Schema4 = {
  ...Validator.Schema,
  bigint: () => new BigIntSchema(),
  date: () => new DateSchema()
};

// billing/data/customer.js
var schema = Schema4.struct({
  customer: Schema4.did({ method: "mailto" }),
  account: Schema4.uri({ protocol: "stripe:" }).optional(),
  product: Schema4.text(),
  details: Schema4.text().optional(),
  insertedAt: Schema4.date(),
  updatedAt: Schema4.date().optional()
});

// billing/tables/customer.js
import { UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall as marshall2 } from "@aws-sdk/util-dynamodb";
var customerTableProps = {
  fields: {
    /** CID of the UCAN invocation that set it to the current value. */
    cause: "string",
    /** DID of the user account e.g. `did:mailto:agent`. */
    customer: "string",
    /**
     * Opaque identifier representing an account in the payment system.
     *
     * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
     */
    account: "string",
    /** Unique identifier of the product a.k.a tier. */
    product: "string",
    /** Misc customer details */
    details: "string",
    /** ISO timestamp record was inserted. */
    insertedAt: "string",
    /** ISO timestamp record was updated. */
    updatedAt: "string"
  },
  primaryIndex: { partitionKey: "customer" }
};

// billing/data/space-diff.js
import * as Link2 from "multiformats/link";
var schema2 = Schema4.struct({
  space: Schema4.did(),
  provider: Schema4.did({ method: "web" }),
  subscription: Schema4.text(),
  cause: Schema4.link({ version: 1 }),
  delta: Schema4.integer(),
  receiptAt: Schema4.date(),
  insertedAt: Schema4.date()
});

// billing/tables/space-diff.js
var spaceDiffTableProps = {
  fields: {
    /** Composite key with format: "provider#space" */
    pk: "string",
    /** Composite key with format: "receiptAt#cause" */
    sk: "string",
    /** Space DID (did:key:...). */
    space: "string",
    /** Storage provider for the space. */
    provider: "string",
    /** Subscription in use when the size changed. */
    subscription: "string",
    /** Invocation CID that changed the space size (bafy...). */
    cause: "string",
    /** Number of bytes added to or removed from the space. */
    delta: "number",
    /** ISO timestamp the receipt was issued. */
    receiptAt: "string",
    /** ISO timestamp we recorded the change. */
    insertedAt: "string"
  },
  primaryIndex: { partitionKey: "pk", sortKey: "sk" }
};

// billing/data/space-snapshot.js
var schema3 = Schema4.struct({
  provider: Schema4.did({ method: "web" }),
  space: Schema4.did(),
  size: Schema4.bigint().greaterThanEqualTo(0n),
  recordedAt: Schema4.date(),
  insertedAt: Schema4.date()
});

// billing/tables/space-snapshot.js
var spaceSnapshotTableProps = {
  fields: {
    /** Composite key with format: "provider#space" */
    pk: "string",
    /**
     * CSV Space DID and Provider DID.
     *
     * e.g. did:key:z6Mksjp3Mbe7TnQbYK43NECF7TRuDGZu9xdzeLg379Dw66mF,did:web:web3.storage
     */
    space: "string",
    /** Space storage provider DID. */
    provider: "string",
    /** Total allocated size in bytes. */
    size: "number",
    /** ISO timestamp allocation was snapshotted. */
    recordedAt: "string",
    /** ISO timestamp record was inserted. */
    insertedAt: "string"
  },
  primaryIndex: { partitionKey: "pk", sortKey: "recordedAt" }
};

// billing/data/usage.js
var schema4 = Schema4.struct({
  customer: Schema4.did({ method: "mailto" }),
  space: Schema4.did(),
  provider: Schema4.did({ method: "web" }),
  account: Schema4.uri({ protocol: "stripe:" }),
  product: Schema4.text(),
  usage: Schema4.bigint().greaterThanEqualTo(0n),
  from: Schema4.date(),
  to: Schema4.date(),
  insertedAt: Schema4.date()
});

// billing/tables/usage.js
var usageTableProps = {
  fields: {
    /** Composite key with format: "from#provider#space" */
    sk: "string",
    /** Customer DID (did:mailto:...). */
    customer: "string",
    /**
     * Opaque identifier representing an account in the payment system.
     * 
     * e.g. Stripe customer ID (stripe:cus_9s6XKzkNRiz8i3)
     */
    account: "string",
    /** Unique identifier of the product a.k.a tier. */
    product: "string",
    /** Storage provider DID (did:web:...). */
    provider: "string",
    /** Space DID (did:key:...). */
    space: "string",
    /** Usage in GB/month */
    usage: "number",
    /** ISO timestamp the usage period spans from (inclusive). */
    from: "string",
    /** ISO timestamp the usage period spans to (exclusive). */
    to: "string",
    /** ISO timestamp we created the invoice. */
    insertedAt: "string"
  },
  primaryIndex: { partitionKey: "customer", sortKey: "sk" }
};

// billing/data/egress.js
var egressSchema = Schema4.struct({
  space: Schema4.did({ method: "key" }),
  customer: Schema4.did({ method: "mailto" }),
  resource: Schema4.link(),
  bytes: Schema4.number(),
  servedAt: Schema4.date(),
  cause: Schema4.link()
});

// billing/tables/egress-traffic.js
var egressTrafficTableProps = {
  fields: {
    /** Composite key with format: "space#resource" */
    pk: "string",
    /** Composite key with format: "servedAt#cause" */
    sk: "string",
    /** Space DID (did:key:...). */
    space: "string",
    /** Customer DID (did:mailto:...). */
    customer: "string",
    /** Resource CID. */
    resource: "string",
    /** ISO timestamp of the event. */
    servedAt: "string",
    /** Bytes served. */
    bytes: "number",
    /** UCAN invocation ID that caused the egress traffic. */
    cause: "string"
  },
  primaryIndex: { partitionKey: "pk", sortKey: "sk" },
  globalIndexes: {
    customer: {
      partitionKey: "customer",
      sortKey: "sk",
      projection: ["space", "resource", "bytes", "cause", "servedAt"]
    }
  }
};

// stacks/billing-db-stack.js
var BillingDbStack = /* @__PURE__ */ __name(({ stack }) => {
  const customerTable = new Table(stack, "customer", customerTableProps);
  const spaceSnapshotTable = new Table(stack, "space-snapshot", spaceSnapshotTableProps);
  const spaceDiffTable = new Table(stack, "space-diff", spaceDiffTableProps);
  const usageTable = new Table(stack, "usage", {
    ...usageTableProps,
    stream: "new_image"
  });
  const egressTrafficTable = new Table(stack, "egress-traffic-events", egressTrafficTableProps);
  stack.addOutputs({
    customerTableName: customerTable.tableName,
    spaceSnapshotTableName: spaceSnapshotTable.tableName,
    spaceDiffTableName: spaceDiffTable.tableName,
    usageTable: usageTable.tableName,
    egressTrafficTableName: egressTrafficTable.tableName
  });
  const stripeSecretKey = new Config.Secret(stack, "STRIPE_SECRET_KEY");
  return { customerTable, spaceSnapshotTable, spaceDiffTable, usageTable, egressTrafficTable, stripeSecretKey };
}, "BillingDbStack");

// stacks/upload-db-stack.js
import { Table as Table2, Bucket as Bucket2, Config as Config2 } from "sst/constructs";

// upload-api/tables/index.js
var storeTableProps = {
  fields: {
    space: "string",
    // `did:key:space`
    link: "string",
    // `bagy...1`
    size: "number",
    // `101`
    origin: "string",
    // `bagy...0` (prev CAR CID. optional)
    issuer: "string",
    // `did:key:agent` (issuer of ucan)
    invocation: "string",
    // `baf...ucan` (CID of invcation UCAN)
    insertedAt: "string"
    // `2022-12-24T...`
  },
  // space + link must be unique to satisfy index constraint
  primaryIndex: { partitionKey: "space", sortKey: "link" },
  globalIndexes: {
    cid: { partitionKey: "link", sortKey: "space", projection: ["space", "insertedAt"] }
  }
};
var blobRegistryTableProps = {
  fields: {
    space: "string",
    // `did:key:space`
    digest: "string",
    // `zQm...`
    size: "number",
    // `101`
    cause: "string",
    // `baf...ucan` (CID of invocation UCAN)
    insertedAt: "string"
    // `2022-12-24T...`
  },
  // space + digest must be unique to satisfy index constraint
  primaryIndex: { partitionKey: "space", sortKey: "digest" },
  globalIndexes: {
    digest: { partitionKey: "digest", sortKey: "space" }
  }
};
var uploadTableProps = {
  fields: {
    space: "string",
    // `did:key:space`
    root: "string",
    // `baf...x`
    shard: "string",
    // `bagy...1
    cause: "string",
    // `baf...ucan` (CID of invocation UCAN)
    insertedAt: "string"
    // `2022-12-24T...`
  },
  // space + root must be unique to satisfy index constraint
  primaryIndex: { partitionKey: "space", sortKey: "root" },
  globalIndexes: {
    cid: { partitionKey: "root", projection: ["space", "insertedAt"] }
  }
};
var allocationTableProps = {
  fields: {
    space: "string",
    // `did:key:space`
    multihash: "string",
    // `bagy...1`
    size: "number",
    // `101`
    cause: "string",
    // `baf...ucan` (CID of invcation UCAN)
    insertedAt: "string"
    // `2022-12-24T...`
  },
  // space + link must be unique to satisfy index constraint
  primaryIndex: { partitionKey: "space", sortKey: "multihash" },
  globalIndexes: {
    multihash: { partitionKey: "multihash", sortKey: "space", projection: ["space", "insertedAt"] },
    // Temporary index to allow migration to blob registry
    insertedAt: { partitionKey: "insertedAt", sortKey: "space", projection: "all" }
  }
};
var delegationTableProps = {
  fields: {
    cause: "string",
    // `baf...x`(CID of the invocation)
    link: "string",
    // `baf...x` (CID of the delegation)
    audience: "string",
    // `did:web:service`
    issuer: "string",
    // `did:key:agent`
    expiration: "number",
    // `9256939505` (unix timestamp in seconds)
    insertedAt: "string",
    // `2022-12-24T...`
    updatedAt: "string"
    // `2022-12-24T...`
  },
  primaryIndex: { partitionKey: "link" },
  globalIndexes: {
    audience: { partitionKey: "audience", projection: ["link"] }
  }
};
var subscriptionTableProps = {
  fields: {
    cause: "string",
    // `baf...x` (CID of invocation that created this subscription)
    provider: "string",
    // `did:web:service` (DID of the provider, e.g. a storage provider)
    customer: "string",
    // `did:mailto:agent` (DID of the user account)
    subscription: "string",
    // string (arbitrary string associated with this subscription)
    insertedAt: "string",
    // `2022-12-24T...`
    updatedAt: "string"
    // `2022-12-24T...`
  },
  primaryIndex: { partitionKey: "subscription", sortKey: "provider" },
  globalIndexes: {
    customer: { partitionKey: "customer", sortKey: "provider", projection: ["cause", "subscription"] },
    provider: { partitionKey: "provider", projection: ["customer"] }
  }
};
var consumerTableProps = {
  fields: {
    cause: "string",
    // `baf...x` (CID of invocation that created this consumer record)
    consumer: "string",
    // `did:key:space` (DID of the actor that is consuming the provider, e.g. a space DID)
    customer: "string",
    // `did:mailto:agent` (DID of the user account)
    provider: "string",
    // `did:web:service` (DID of the provider, e.g. a storage provider)
    subscription: "string",
    // string (arbitrary string associated with this subscription)
    insertedAt: "string",
    // `2022-12-24T...`
    updatedAt: "string"
    // `2022-12-24T...`
  },
  primaryIndex: { partitionKey: "subscription", sortKey: "provider" },
  globalIndexes: {
    consumer: { partitionKey: "consumer", projection: ["provider", "subscription"] },
    consumerV2: { partitionKey: "consumer", projection: ["provider", "subscription", "customer"] },
    provider: { partitionKey: "provider", projection: ["consumer"] },
    customer: { partitionKey: "customer", projection: ["consumer", "provider", "subscription", "cause"] }
  }
};
var rateLimitTableProps = {
  fields: {
    id: "string",
    // arbitrary identifier for this limit
    cause: "string",
    // `baf...x` (CID of invocation that created record)
    subject: "string",
    // string (arbitrary string identifying the subject to be limited)
    rate: "number",
    // unitless number representing the rate to which the subject is limited
    insertedAt: "string",
    // `2022-12-24T...`
    updatedAt: "string"
    // `2022-12-24T...`
  },
  primaryIndex: { partitionKey: "id" },
  globalIndexes: {
    subject: { partitionKey: "subject", projection: ["rate", "id"] }
  }
};
var revocationTableProps = {
  fields: {
    // we'll store scope and cause in a map-type attribute keyed by scope CID
    revoke: "string"
    // `baf...x`(CID of the revoked delegation)
  },
  primaryIndex: { partitionKey: "revoke" }
};
var humanodeTableProps = {
  fields: {
    // the humanode "subject" - `sub` matches the name it is given in the JWT we receive.
    sub: "string",
    // the ID of the storacha user associated with this subject
    account: "string"
  },
  primaryIndex: { partitionKey: "sub" },
  globalIndexes: {
    account: { partitionKey: "account", projection: ["sub"] }
  }
};
var adminMetricsTableProps = {
  fields: {
    name: "string",
    // `total-size`
    value: "number"
    // `101`
  },
  // name must be unique to satisfy index constraint
  primaryIndex: { partitionKey: "name" }
};
var spaceMetricsTableProps = {
  fields: {
    space: "string",
    // `did:key:space`
    name: "string",
    // `upload/add-count`
    value: "number"
    // `101`
  },
  // space+name must be unique to satisfy index constraint
  primaryIndex: { partitionKey: "space", sortKey: "name" }
};
var storageProviderTableProps = {
  fields: {
    // DID of the stroage provider.
    provider: "string",
    // Public URL that accepts UCAN invocations.
    endpoint: "string",
    // Proof the upload service can invoke blob/allocate and blob/accept.
    proof: "string",
    // Weight determines chance of selection relative to other providers.
    weight: "number",
    // Date and time the record was created (ISO 8601)
    insertedAt: "string",
    // Date and time the record was last updated (ISO 8601)
    updatedAt: "string"
  },
  primaryIndex: { partitionKey: "provider" }
};
var replicaTableProps = {
  fields: {
    /** Composite key with format: "space#digest" */
    pk: "string",
    /** DID of Space the blob is registered in. */
    space: "string",
    /** Base58btc encoded multihash of the blob. */
    digest: "string",
    /** DID of the replica node. */
    provider: "string",
    /** Status of the replication (allocated/transferred/failed). */
    status: "string",
    /** CID of `blob/replica/allocate` UCAN that allocated the replica space. */
    cause: "string",
    /** Date and time the record was created (ISO 8601) */
    insertedAt: "string",
    /** Date and time the record was last updated (ISO 8601) */
    updatedAt: "string"
  },
  primaryIndex: { partitionKey: "pk", sortKey: "provider" }
};

// filecoin/store/index.js
var pieceTableProps = {
  fields: {
    piece: "string",
    // `baga...1`
    content: "string",
    // `bagy...1`
    group: "string",
    // `did:web:free.web3.storage`
    stat: "number",
    // `0` as 'SUBMITTED' | `1` as 'ACCEPTED' | `2` as 'INVALID'
    insertedAt: "string",
    // `2022-12-24T...`
    updatedAt: "string"
    // `2022-12-24T...`
  },
  primaryIndex: { partitionKey: "piece" },
  globalIndexes: {
    content: { partitionKey: "content", projection: "all" },
    stat: { partitionKey: "stat", sortKey: "insertedAt", projection: "all" }
  }
};

// stacks/upload-db-stack.js
function UploadDbStack({ stack, app }) {
  setupSentry(app, stack);
  const privateKey = new Config2.Secret(stack, "PRIVATE_KEY");
  const contentClaimsPrivateKey = new Config2.Secret(stack, "CONTENT_CLAIMS_PRIVATE_KEY");
  const indexingServiceProof = new Config2.Secret(stack, "INDEXING_SERVICE_PROOF");
  const githubClientSecret = new Config2.Secret(stack, "GITHUB_CLIENT_SECRET");
  const humanodeClientSecret = new Config2.Secret(stack, "HUMANODE_CLIENT_SECRET");
  const dmailApiKey = new Config2.Secret(stack, "DMAIL_API_KEY");
  const dmailApiSecret = new Config2.Secret(stack, "DMAIL_API_SECRET");
  const dmailJwtSecret = new Config2.Secret(stack, "DMAIL_JWT_SECRET");
  const humanodeTable = new Table2(stack, "humanode", humanodeTableProps);
  const allocationTable = new Table2(stack, "allocation", allocationTableProps);
  const blobRegistryTable = new Table2(stack, "blob-registry", blobRegistryTableProps);
  const storeTable = new Table2(stack, "store", storeTableProps);
  const uploadTable = new Table2(stack, "upload", uploadTableProps);
  const pieceTable = new Table2(stack, "piece-v2", {
    ...pieceTableProps,
    // information that will be written to the stream
    stream: "new_image"
  });
  const subscriptionTable = new Table2(stack, "subscription", subscriptionTableProps);
  const consumerTable = new Table2(stack, "consumer", consumerTableProps);
  const rateLimitTable = new Table2(stack, "rate-limit", rateLimitTableProps);
  const delegationBucket = new Bucket2(stack, "delegation-store", {
    cors: true,
    cdk: {
      bucket: getBucketConfig("delegation", app.stage, app.name)
    }
  });
  const delegationTable = new Table2(stack, "delegation", delegationTableProps);
  const revocationTable = new Table2(stack, "revocation", revocationTableProps);
  const adminMetricsTable = new Table2(stack, "admin-metrics", adminMetricsTableProps);
  const spaceMetricsTable = new Table2(stack, "space-metrics", spaceMetricsTableProps);
  const storageProviderTable = new Table2(stack, "storage-provider", storageProviderTableProps);
  const replicaTable = new Table2(stack, "replica", replicaTableProps);
  return {
    allocationTable,
    blobRegistryTable,
    humanodeTable,
    storeTable,
    uploadTable,
    pieceTable,
    consumerTable,
    subscriptionTable,
    rateLimitTable,
    delegationBucket,
    delegationTable,
    revocationTable,
    adminMetricsTable,
    spaceMetricsTable,
    storageProviderTable,
    replicaTable,
    privateKey,
    githubClientSecret,
    contentClaimsPrivateKey,
    humanodeClientSecret,
    indexingServiceProof,
    dmailApiKey,
    dmailApiSecret,
    dmailJwtSecret
  };
}
__name(UploadDbStack, "UploadDbStack");

// stacks/billing-stack.js
function BillingStack({ stack, app }) {
  setupSentry(app, stack);
  const {
    customerTable,
    spaceSnapshotTable,
    spaceDiffTable,
    usageTable,
    egressTrafficTable,
    stripeSecretKey
  } = use(BillingDbStack);
  const { subscriptionTable, consumerTable } = use(UploadDbStack);
  const spaceBillingQueueHandler = new Function(stack, "space-billing-queue-handler", {
    permissions: [spaceSnapshotTable, spaceDiffTable, usageTable],
    handler: "billing/functions/space-billing-queue.handler",
    timeout: "15 minutes",
    environment: {
      SPACE_DIFF_TABLE_NAME: spaceDiffTable.tableName,
      SPACE_SNAPSHOT_TABLE_NAME: spaceSnapshotTable.tableName,
      USAGE_TABLE_NAME: usageTable.tableName
    }
  });
  const spaceBillingDLQ = new Queue(stack, "space-billing-dlq", {
    cdk: { queue: { retentionPeriod: Duration2.days(14) } }
  });
  const spaceBillingQueue = new Queue(stack, "space-billing-queue", {
    consumer: {
      function: spaceBillingQueueHandler,
      deadLetterQueue: spaceBillingDLQ.cdk.queue,
      cdk: { eventSource: { batchSize: 1 } }
    },
    cdk: { queue: { visibilityTimeout: Duration2.minutes(15) } }
  });
  const customerBillingQueueHandler = new Function(stack, "customer-billing-queue-handler", {
    permissions: [subscriptionTable, consumerTable, spaceBillingQueue],
    handler: "billing/functions/customer-billing-queue.handler",
    timeout: "15 minutes",
    environment: {
      SUBSCRIPTION_TABLE_NAME: subscriptionTable.tableName,
      CONSUMER_TABLE_NAME: consumerTable.tableName,
      SPACE_BILLING_QUEUE_URL: spaceBillingQueue.queueUrl
    }
  });
  const customerBillingDLQ = new Queue(stack, "customer-billing-dlq", {
    cdk: { queue: { retentionPeriod: Duration2.days(14) } }
  });
  const customerBillingQueue = new Queue(stack, "customer-billing-queue", {
    consumer: {
      function: customerBillingQueueHandler,
      deadLetterQueue: customerBillingDLQ.cdk.queue,
      cdk: { eventSource: { batchSize: 1 } }
    },
    cdk: { queue: { visibilityTimeout: Duration2.minutes(15) } }
  });
  const billingCronHandler = new Function(stack, "billing-cron-handler", {
    permissions: [customerTable, customerBillingQueue],
    handler: "billing/functions/billing-cron.handler",
    timeout: "15 minutes",
    environment: {
      CUSTOMER_TABLE_NAME: customerTable.tableName,
      CUSTOMER_BILLING_QUEUE_URL: customerBillingQueue.queueUrl
    },
    url: true
  });
  const billingCronHandlerURL = billingCronHandler.url ?? "";
  const billingCron = new Cron(stack, "billing-cron", {
    job: billingCronHandler,
    schedule: "cron(0 0 1 * ? *)"
    // https://crontab.guru/#0_0_1_*_*
  });
  const { ucanStream } = use(UcanInvocationStack);
  const ucanStreamHandler = new Function(stack, "ucan-stream-handler", {
    permissions: [spaceDiffTable, consumerTable],
    handler: "billing/functions/ucan-stream.handler",
    environment: {
      SPACE_DIFF_TABLE_NAME: spaceDiffTable.tableName,
      CONSUMER_TABLE_NAME: consumerTable.tableName
    }
  });
  ucanStream.addConsumers(stack, {
    ucanStreamHandler: {
      function: ucanStreamHandler,
      cdk: {
        eventSource: {
          batchSize: 25,
          // max dynamo BatchWriteItems size
          bisectBatchOnError: true,
          startingPosition: StartingPosition2.LATEST,
          filters: [
            FilterCriteria.filter({
              data: {
                type: FilterRule.isEqual("receipt")
              }
            })
          ],
          parallelizationFactor: 10
        }
      }
    }
  });
  const usageTableHandler = new Function(stack, "usage-table-handler", {
    permissions: [spaceSnapshotTable, spaceDiffTable],
    handler: "billing/functions/usage-table.handler",
    timeout: "15 minutes",
    bind: [stripeSecretKey]
  });
  const usageTableDLQ = new Queue(stack, "usage-table-dlq", {
    cdk: { queue: { retentionPeriod: Duration2.days(14) } }
  });
  usageTable.addConsumers(stack, {
    usageTableHandler: {
      function: usageTableHandler,
      cdk: {
        eventSource: {
          batchSize: 1,
          startingPosition: StartingPosition2.LATEST,
          retryAttempts: 10,
          onFailure: new SqsDlq(usageTableDLQ.cdk.queue)
        }
      },
      filters: [{ eventName: ["INSERT"] }]
    }
  });
  stack.addOutputs({ billingCronHandlerURL });
  const customDomain = getCustomDomain(stack.stage, process.env.BILLING_HOSTED_ZONE);
  const stripeEndpointSecret = new Config3.Secret(stack, "STRIPE_ENDPOINT_SECRET");
  const api = new Api(stack, "billing-http-gateway", {
    customDomain,
    defaults: {
      function: {
        permissions: [customerTable],
        bind: [stripeSecretKey, stripeEndpointSecret],
        environment: {
          CUSTOMER_TABLE_NAME: customerTable.tableName
        }
      }
    },
    routes: {
      "POST /stripe": "billing/functions/stripe.webhook"
    },
    accessLog: {
      format: '{"requestTime":"$context.requestTime","requestId":"$context.requestId","httpMethod":"$context.httpMethod","path":"$context.path","routeKey":"$context.routeKey","status":$context.status,"responseLatency":$context.responseLatency,"integrationRequestId":"$context.integration.requestId","integrationStatus":"$context.integration.status","integrationLatency":"$context.integration.latency","integrationServiceStatus":"$context.integration.integrationStatus","ip":"$context.identity.sourceIp","userAgent":"$context.identity.userAgent"}'
    }
  });
  stack.addOutputs({
    ApiEndpoint: api.url,
    CustomDomain: customDomain ? `https://${customDomain.domainName}` : "Set BILLING_HOSTED_ZONE in env to deploy to a custom domain"
  });
  const egressTrafficQueueHandler = new Function(stack, "egress-traffic-queue-handler", {
    permissions: [customerTable, egressTrafficTable],
    handler: "billing/functions/egress-traffic-queue.handler",
    timeout: "15 minutes",
    bind: [stripeSecretKey],
    environment: {
      CUSTOMER_TABLE_NAME: customerTable.tableName,
      EGRESS_TRAFFIC_TABLE_NAME: egressTrafficTable.tableName,
      // Billing Meter Event Name for Stripe Test and Production APIs
      STRIPE_BILLING_METER_EVENT_NAME: "gateway-egress-traffic"
    }
  });
  const egressTrafficDLQ = new Queue(stack, "egress-traffic-dlq", {
    cdk: { queue: { retentionPeriod: Duration2.days(14) } }
  });
  const egressTrafficQueue = new Queue(stack, "egress-traffic-queue", {
    consumer: {
      function: egressTrafficQueueHandler,
      deadLetterQueue: egressTrafficDLQ.cdk.queue,
      cdk: { eventSource: { batchSize: 10 } }
    },
    cdk: { queue: { visibilityTimeout: Duration2.minutes(15) } }
  });
  stack.addOutputs({
    EgressTrafficQueueURL: egressTrafficQueue.queueUrl
  });
  return { billingCron, egressTrafficQueue };
}
__name(BillingStack, "BillingStack");

// stacks/upload-api-stack.js
import { Api as Api3, Config as Config4, Function as Function4, Queue as Queue7, use as use4 } from "sst/constructs";
import {
  StartingPosition as StartingPosition4,
  FilterCriteria as FilterCriteria2,
  FilterRule as FilterRule2
} from "aws-cdk-lib/aws-lambda";

// stacks/carpark-stack.js
import {
  Bucket as Bucket3,
  Function as Function2,
  Queue as Queue2,
  use as use2
} from "sst/constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";

// stacks/bus-stack.js
import { EventBus } from "sst/constructs";
function BusStack({ stack, app }) {
  setupSentry(app, stack);
  const eventBus = new EventBus(stack, "event-bus");
  return {
    eventBus
  };
}
__name(BusStack, "BusStack");

// carpark/event-bus/source.js
var CARPARK_EVENT_BRIDGE_SOURCE_EVENT = "carpark_bucket";

// stacks/carpark-stack.js
function CarparkStack({ stack, app }) {
  setupSentry(app, stack);
  const { eventBus } = use2(BusStack);
  const { EIPFS_INDEXER_SQS_ARN, EIPFS_INDEXER_SQS_URL } = getEnv2();
  const carparkBucket = new Bucket3(stack, "car-store", {
    cors: true,
    cdk: {
      bucket: getBucketConfig("carpark", app.stage, app.name)
    }
  });
  const indexerTopicQueue = new Queue2(stack, "indexer-topic-queue", {
    cdk: {
      queue: sqs.Queue.fromQueueArn(
        stack,
        "indexer-topic",
        EIPFS_INDEXER_SQS_ARN
      )
    }
  });
  const eIpfsIndexTarget = {
    function: {
      environment: {
        EIPFS_INDEXER_SQS_URL
      },
      permissions: [indexerTopicQueue],
      handler: "carpark/event-bus/eipfs-indexer.handler"
    }
  };
  eventBus.addRules(stack, {
    newCar: {
      pattern: {
        source: [CARPARK_EVENT_BRIDGE_SOURCE_EVENT]
      },
      targets: {
        eIpfsIndexTarget
      }
    }
  });
  const carparkPutEventConsumer = new Function2(stack, "carpark-consumer", {
    environment: {
      EVENT_BUS_ARN: eventBus.eventBusArn
    },
    permissions: [eventBus],
    handler: "carpark/functions/carpark-bucket-event.carparkBucketConsumer"
  });
  carparkBucket.addNotifications(stack, {
    newCarPut: {
      function: carparkPutEventConsumer,
      events: ["object_created"]
    }
  });
  stack.addOutputs({
    BucketName: carparkBucket.bucketName,
    Region: stack.region
  });
  return {
    carparkBucket
  };
}
__name(CarparkStack, "CarparkStack");
function getEnv2() {
  return {
    EIPFS_INDEXER_SQS_ARN: mustGetEnv("EIPFS_INDEXER_SQS_ARN"),
    EIPFS_INDEXER_SQS_URL: mustGetEnv("EIPFS_INDEXER_SQS_URL")
  };
}
__name(getEnv2, "getEnv");

// stacks/filecoin-stack.js
import {
  Cron as Cron2,
  Function as Function3,
  Queue as Queue4,
  use as use3
} from "sst/constructs";
import { Duration as Duration3, aws_events as awsEvents } from "aws-cdk-lib";
import { StartingPosition as StartingPosition3 } from "aws-cdk-lib/aws-lambda";

// stacks/roundabout-stack.js
import {
  Api as Api2
} from "sst/constructs";
function RoundaboutStack({ stack, app }) {
  if (process.env.ROUNDABOUT_API_URL) {
    const url = new URL(process.env.ROUNDABOUT_API_URL);
    stack.addOutputs({
      ApiEndpoint: url.toString(),
      CustomDomain: "Using ROUNDABOUT_API_URL - no custom domain"
    });
    return { roundaboutApiUrl: url.toString() };
  }
  setupSentry(app, stack);
  const customDomain = getCustomDomain(stack.stage, process.env.ROUNDABOUT_HOSTED_ZONE);
  const api = new Api2(stack, "roundabout-http-gateway", {
    customDomain,
    defaults: {
      function: {
        environment: {
          BUCKET_ENDPOINT: process.env.R2_ENDPOINT ?? "",
          BUCKET_REGION: process.env.R2_REGION ?? "",
          BUCKET_NAME: process.env.R2_CARPARK_BUCKET_NAME ?? "",
          BUCKET_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? "",
          BUCKET_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? "",
          ROUNDABOUT_INDEXING_SERVICE_URLS: process.env.ROUNDABOUT_INDEXING_SERVICE_URLS ?? ""
        }
      }
    },
    routes: {
      "GET /{cid}": "roundabout/functions/redirect.handler",
      "HEAD /{cid}": "roundabout/functions/redirect.handler",
      "GET /key/{key}": "roundabout/functions/redirect.keyHandler",
      "HEAD /key/{key}": "roundabout/functions/redirect.keyHandler"
    },
    accessLog: {
      format: '{"requestTime":"$context.requestTime","requestId":"$context.requestId","httpMethod":"$context.httpMethod","path":"$context.path","routeKey":"$context.routeKey","status":$context.status,"responseLatency":$context.responseLatency,"integrationRequestId":"$context.integration.requestId","integrationStatus":"$context.integration.status","integrationLatency":"$context.integration.latency","integrationServiceStatus":"$context.integration.integrationStatus","ip":"$context.identity.sourceIp","userAgent":"$context.identity.userAgent"}'
    }
  });
  stack.addOutputs({
    ApiEndpoint: api.url,
    CustomDomain: customDomain ? `https://${customDomain.domainName}` : "Set HOSTED_ZONE in env to deploy to a custom domain"
  });
  return {
    roundaboutApiUrl: api.url
  };
}
__name(RoundaboutStack, "RoundaboutStack");

// filecoin/store/piece.js
import {
  PutItemCommand as PutItemCommand2,
  GetItemCommand as GetItemCommand2,
  UpdateItemCommand as UpdateItemCommand2,
  QueryCommand as QueryCommand2
} from "@aws-sdk/client-dynamodb";
import { marshall as marshall3, unmarshall as unmarshall2 } from "@aws-sdk/util-dynamodb";
var Status = {
  SUBMITTED: 0,
  ACCEPTED: 1,
  INVALID: 2
};

// stacks/filecoin-stack.js
function FilecoinStack({ stack, app }) {
  const {
    AGGREGATOR_DID,
    AGGREGATOR_URL,
    INDEXING_SERVICE_DID,
    INDEXING_SERVICE_URL,
    CONTENT_CLAIMS_DID,
    CONTENT_CLAIMS_URL,
    DISABLE_PIECE_CID_COMPUTE,
    UPLOAD_API_DID,
    STOREFRONT_PROOF,
    START_FILECOIN_METRICS_EPOCH_MS
  } = getEnv();
  const storefrontCustomDomain = getCustomDomain(stack.stage, process.env.HOSTED_ZONES?.split(",")[0]);
  setupSentry(app, stack);
  const { carparkBucket } = use3(CarparkStack);
  const { eventBus } = use3(BusStack);
  const { pieceTable, privateKey, adminMetricsTable, indexingServiceProof, contentClaimsPrivateKey } = use3(UploadDbStack);
  const { agentMessageBucket, agentIndexBucket, ucanStream } = use3(UcanInvocationStack);
  const { roundaboutApiUrl } = use3(RoundaboutStack);
  const filecoinSubmitQueueName = getCdkNames("filecoin-submit-queue", stack.stage, app.name);
  const filecoinSubmitQueueDLQ = new Queue4(stack, `${filecoinSubmitQueueName}-dlq`, {
    cdk: { queue: { retentionPeriod: Duration3.days(14) } }
  });
  const filecoinSubmitQueue = new Queue4(stack, filecoinSubmitQueueName, {
    cdk: {
      queue: {
        visibilityTimeout: Duration3.seconds(15 * 60)
      }
    }
  });
  filecoinSubmitQueue.addConsumer(stack, {
    function: {
      handler: "filecoin/functions/handle-filecoin-submit-message.main",
      environment: {
        PIECE_TABLE_NAME: pieceTable.tableName,
        CONTENT_STORE_HTTP_ENDPOINT: roundaboutApiUrl
      },
      permissions: [pieceTable],
      // piece is computed in this lambda
      timeout: 15 * 60
    },
    deadLetterQueue: filecoinSubmitQueueDLQ.cdk.queue,
    cdk: {
      eventSource: {
        batchSize: 1
      }
    }
  });
  const pieceOfferQueueName = getCdkNames("piece-offer-queue", stack.stage, app.name);
  const pieceOfferQueueDLQ = new Queue4(stack, `${pieceOfferQueueName}-dlq`, {
    cdk: { queue: { retentionPeriod: Duration3.days(14) } }
  });
  const pieceOfferQueue = new Queue4(stack, pieceOfferQueueName);
  pieceOfferQueue.addConsumer(stack, {
    function: {
      handler: "filecoin/functions/handle-piece-offer-message.main",
      environment: {
        DID: STOREFRONT_PROOF ? UPLOAD_API_DID : AGGREGATOR_DID,
        AGGREGATOR_DID,
        AGGREGATOR_URL,
        PROOF: STOREFRONT_PROOF
      },
      bind: [
        privateKey
      ]
    },
    deadLetterQueue: pieceOfferQueueDLQ.cdk.queue,
    cdk: {
      eventSource: {
        batchSize: 1
      }
    }
  });
  const dealTrackCronName = getCdkNames("deal-track-cron", stack.stage, app.name);
  new Cron2(stack, dealTrackCronName, {
    schedule: "rate(6 minutes)",
    job: {
      function: {
        handler: "filecoin/functions/handle-cron-tick.main",
        environment: {
          DID: STOREFRONT_PROOF ? UPLOAD_API_DID : AGGREGATOR_DID,
          PIECE_TABLE_NAME: pieceTable.tableName,
          AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
          AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
          AGGREGATOR_DID,
          PROOF: STOREFRONT_PROOF
        },
        timeout: "6 minutes",
        bind: [privateKey],
        permissions: [pieceTable, agentMessageBucket, agentIndexBucket]
      }
    }
  });
  const pieceTableHandleInserToClaimtDLQ = new Queue4(stack, `piece-table-handle-insert-to-claim-dlq`, {
    cdk: { queue: { retentionPeriod: Duration3.days(14) } }
  });
  const pieceTableHandleInserToFilecoinSubmitDLQ = new Queue4(stack, `piece-table-handle-insert-to-filecoin-submit-dlq`, {
    cdk: { queue: { retentionPeriod: Duration3.days(14) } }
  });
  const pieceTableHandleStatusUpdateDLQ = new Queue4(stack, `piece-table-handle-status-update-dlq`, {
    cdk: { queue: { retentionPeriod: Duration3.days(14) } }
  });
  pieceTable.addConsumers(stack, {
    handlePieceInsertToContentClaim: {
      function: {
        handler: "filecoin/functions/handle-piece-insert-to-content-claim.main",
        environment: {
          STOREFRONT_DID: UPLOAD_API_DID,
          INDEXING_SERVICE_DID,
          INDEXING_SERVICE_URL,
          CONTENT_CLAIMS_DID,
          CONTENT_CLAIMS_URL
        },
        timeout: 3 * 60,
        bind: [
          privateKey,
          indexingServiceProof,
          contentClaimsPrivateKey
        ]
      },
      deadLetterQueue: pieceTableHandleInserToClaimtDLQ.cdk.queue,
      cdk: {
        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_event_sources.DynamoEventSourceProps.html#filters
        eventSource: {
          batchSize: 1,
          // Start reading at the last untrimmed record in the shard in the system.
          startingPosition: StartingPosition3.TRIM_HORIZON
        }
      },
      filters: [
        {
          eventName: ["INSERT"]
        }
      ]
    },
    handlePieceInsertToFilecoinSubmit: {
      function: {
        handler: "filecoin/functions/handle-piece-insert-to-filecoin-submit.main",
        environment: {
          STOREFRONT_DID: UPLOAD_API_DID,
          STOREFRONT_URL: storefrontCustomDomain?.domainName ? `https://${storefrontCustomDomain?.domainName}` : ""
        },
        timeout: 3 * 60,
        bind: [
          privateKey
        ]
      },
      deadLetterQueue: pieceTableHandleInserToFilecoinSubmitDLQ.cdk.queue,
      cdk: {
        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_event_sources.DynamoEventSourceProps.html#filters
        eventSource: {
          batchSize: 1,
          // Start reading at the last untrimmed record in the shard in the system.
          startingPosition: StartingPosition3.TRIM_HORIZON
        }
      },
      filters: [
        {
          eventName: ["INSERT"]
        }
      ]
    },
    handlePieceStatusUpdate: {
      function: {
        handler: "filecoin/functions/handle-piece-status-update.main",
        environment: {
          STOREFRONT_DID: UPLOAD_API_DID,
          STOREFRONT_URL: storefrontCustomDomain?.domainName ? `https://${storefrontCustomDomain?.domainName}` : ""
        },
        timeout: 3 * 60,
        bind: [
          privateKey
        ]
      },
      deadLetterQueue: pieceTableHandleStatusUpdateDLQ.cdk.queue,
      cdk: {
        // https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_event_sources.DynamoEventSourceProps.html#filters
        eventSource: {
          batchSize: 1,
          // Start reading at the last untrimmed record in the shard in the system.
          startingPosition: StartingPosition3.TRIM_HORIZON
        }
      },
      filters: [
        {
          dynamodb: {
            NewImage: {
              stat: {
                N: [`${Status.ACCEPTED}`, `${Status.INVALID}`]
              }
            }
          }
        }
      ]
    }
  });
  const pieceCidComputeHandler = new Function3(
    stack,
    "piece-cid-compute-handler",
    {
      environment: {
        DISABLE_PIECE_CID_COMPUTE,
        STOREFRONT_DID: UPLOAD_API_DID,
        STOREFRONT_URL: storefrontCustomDomain?.domainName ? `https://${storefrontCustomDomain?.domainName}` : ""
      },
      bind: [
        privateKey
      ],
      permissions: [pieceTable, carparkBucket],
      timeout: "5 minutes",
      handler: "filecoin/functions/piece-cid-compute.handler"
    }
  );
  const pieceCidComputeQueueDLQ = new Queue4(stack, `piece-cid-compute-queue-dlq`, {
    cdk: { queue: { retentionPeriod: Duration3.days(14) } }
  });
  const pieceCidComputeQueue = new Queue4(stack, "piece-cid-compute-queue", {
    consumer: {
      function: pieceCidComputeHandler,
      deadLetterQueue: pieceCidComputeQueueDLQ.cdk.queue,
      cdk: {
        eventSource: {
          batchSize: 1
        }
      }
    },
    cdk: {
      queue: {
        // Needs to be set as less or equal than consumer function
        visibilityTimeout: Duration3.seconds(15 * 60)
      }
    }
  });
  const targetPieceCidComputeQueue = {
    type: "queue",
    queue: pieceCidComputeQueue,
    cdk: {
      target: {
        message: awsEvents.RuleTargetInput.fromObject({
          bucketRegion: awsEvents.EventField.fromPath("$.detail.region"),
          bucketName: awsEvents.EventField.fromPath("$.detail.bucketName"),
          key: awsEvents.EventField.fromPath("$.detail.key")
        })
      }
    }
  };
  eventBus.addRules(stack, {
    newCarToComputePiece: {
      pattern: {
        source: [CARPARK_EVENT_BRIDGE_SOURCE_EVENT]
      },
      targets: {
        targetPieceCidComputeQueue
      }
    }
  });
  const metricsAggregateTotalDLQ = new Queue4(stack, "metrics-aggregate-total-dlq");
  const metricsAggregateTotalConsumer = new Function3(stack, "metrics-aggregate-total-consumer", {
    environment: {
      METRICS_TABLE_NAME: adminMetricsTable.tableName,
      AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
      AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
      START_FILECOIN_METRICS_EPOCH_MS
    },
    permissions: [adminMetricsTable, agentMessageBucket, agentIndexBucket],
    handler: "filecoin/functions/metrics-aggregate-offer-and-accept-total.consumer",
    deadLetterQueue: metricsAggregateTotalDLQ.cdk.queue,
    timeout: 3 * 60
  });
  ucanStream.addConsumers(stack, {
    metricsAggregateTotalConsumer: {
      function: metricsAggregateTotalConsumer,
      cdk: {
        eventSource: {
          ...getEventSourceConfig(stack)
        }
      }
    }
  });
  return {
    filecoinSubmitQueue,
    pieceOfferQueue
  };
}
__name(FilecoinStack, "FilecoinStack");

// stacks/indexer-stack.js
import { Queue as Queue5, Table as Table3 } from "sst/constructs";
import { Duration as Duration4 } from "aws-cdk-lib";
import * as sqs2 from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
function IndexerStack({ stack, app }) {
  const {
    EIPFS_MULTIHASHES_SQS_ARN,
    EIPFS_BLOCKS_CAR_POSITION_TABLE_ARN
  } = getEnv();
  setupSentry(app, stack);
  const indexerRegion = EIPFS_MULTIHASHES_SQS_ARN.split(":")[3];
  const multihashesQueue = new Queue5(stack, "eipfs-multihashes-topic-queue", {
    cdk: {
      queue: sqs2.Queue.fromQueueArn(
        stack,
        "multihashes-topic",
        EIPFS_MULTIHASHES_SQS_ARN
      )
    }
  });
  const blocksCarsPositionTable = new Table3(stack, "eipfs-blocks-cars-position-table", {
    cdk: {
      table: dynamodb.Table.fromTableArn(
        stack,
        "blocks-cars-position",
        EIPFS_BLOCKS_CAR_POSITION_TABLE_ARN
      )
    }
  });
  const blockAdvertPublisherQueue = new Queue5(stack, "block-advert-publisher-queue", {
    cdk: { queue: { visibilityTimeout: Duration4.minutes(15) } }
  });
  const blockAdvertPublisherDLQ = new Queue5(stack, "block-advert-publisher-dlq", {
    cdk: { queue: { retentionPeriod: Duration4.days(14) } }
  });
  blockAdvertPublisherQueue.addConsumer(stack, {
    function: {
      handler: "indexer/functions/handle-block-advert-publish-message.main",
      environment: {
        MULTIHASHES_QUEUE_URL: multihashesQueue.queueUrl,
        INDEXER_REGION: indexerRegion
      },
      permissions: [multihashesQueue],
      timeout: 15 * 60
    },
    deadLetterQueue: blockAdvertPublisherDLQ.cdk.queue,
    cdk: {
      eventSource: {
        batchSize: 1
      }
    }
  });
  const blockIndexWriterQueue = new Queue5(stack, "block-index-writer-queue", {
    cdk: { queue: { visibilityTimeout: Duration4.minutes(15) } }
  });
  const blockIndexWriterDLQ = new Queue5(stack, "block-index-writer-dlq", {
    cdk: { queue: { retentionPeriod: Duration4.days(14) } }
  });
  blockIndexWriterQueue.addConsumer(stack, {
    function: {
      handler: "indexer/functions/handle-block-index-writer-message.main",
      environment: {
        BLOCKS_CAR_POSITION_TABLE_NAME: blocksCarsPositionTable.tableName,
        INDEXER_REGION: indexerRegion
      },
      permissions: [blocksCarsPositionTable],
      timeout: 15 * 60
    },
    deadLetterQueue: blockIndexWriterDLQ.cdk.queue,
    cdk: {
      eventSource: {
        batchSize: 1
      }
    }
  });
  return { blockAdvertPublisherQueue, blockIndexWriterQueue };
}
__name(IndexerStack, "IndexerStack");

// stacks/upload-api-stack.js
function UploadApiStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    nodejs: {
      esbuild: {
        loader: {
          ".svg": "text"
        }
      }
    }
  });
  const {
    AGGREGATOR_DID,
    INDEXING_SERVICE_DID,
    INDEXING_SERVICE_URL,
    CONTENT_CLAIMS_DID,
    CONTENT_CLAIMS_URL,
    DISABLE_IPNI_PUBLISHING
  } = getEnv();
  setupSentry(app, stack);
  const { carparkBucket } = use4(CarparkStack);
  const {
    allocationTable,
    blobRegistryTable,
    humanodeTable,
    storeTable,
    uploadTable,
    delegationBucket,
    delegationTable,
    revocationTable,
    adminMetricsTable,
    spaceMetricsTable,
    consumerTable,
    subscriptionTable,
    storageProviderTable,
    replicaTable,
    rateLimitTable,
    pieceTable,
    privateKey,
    contentClaimsPrivateKey,
    indexingServiceProof,
    githubClientSecret,
    humanodeClientSecret,
    dmailApiKey,
    dmailApiSecret,
    dmailJwtSecret
  } = use4(UploadDbStack);
  const { agentIndexBucket, agentMessageBucket, ucanStream } = use4(UcanInvocationStack);
  const {
    customerTable,
    spaceDiffTable,
    spaceSnapshotTable,
    egressTrafficTable,
    stripeSecretKey
  } = use4(BillingDbStack);
  const { pieceOfferQueue, filecoinSubmitQueue } = use4(FilecoinStack);
  let ipniConfig;
  if (DISABLE_IPNI_PUBLISHING !== "true") {
    const { blockAdvertPublisherQueue, blockIndexWriterQueue } = use4(IndexerStack);
    ipniConfig = {
      permissions: [blockAdvertPublisherQueue, blockIndexWriterQueue],
      environment: {
        BLOCK_ADVERT_PUBLISHER_QUEUE_URL: blockAdvertPublisherQueue.queueUrl,
        BLOCK_INDEX_WRITER_QUEUE_URL: blockIndexWriterQueue.queueUrl
      }
    };
  }
  const { egressTrafficQueue } = use4(BillingStack);
  const customDomains = process.env.HOSTED_ZONES?.split(",").map(
    (zone) => getCustomDomain(stack.stage, zone)
  );
  const pkg = getApiPackageJson();
  const git2 = getGitInfo();
  const ucanInvocationPostbasicAuth = new Config4.Secret(
    stack,
    "UCAN_INVOCATION_POST_BASIC_AUTH"
  );
  const apis = (customDomains ?? [void 0]).map((customDomain, idx) => {
    const hostedZone = customDomain?.hostedZone;
    const apiId = [
      `http-gateway`,
      idx > 0 ? hostedZone?.replaceAll(".", "_") : ""
    ].filter(Boolean).join("-");
    return new Api3(stack, apiId, {
      customDomain,
      defaults: {
        function: {
          timeout: "60 seconds",
          environment: {
            NAME: pkg.name,
            VERSION: pkg.version,
            COMMIT: git2.commmit,
            STAGE: stack.stage
          }
        }
      },
      routes: {
        "POST /": {
          function: {
            handler: "upload-api/functions/ucan-invocation-router.handler",
            permissions: [
              adminMetricsTable,
              agentIndexBucket,
              agentMessageBucket,
              allocationTable,
              // legacy
              blobRegistryTable,
              carparkBucket,
              consumerTable,
              customerTable,
              delegationBucket,
              delegationTable,
              egressTrafficQueue,
              egressTrafficTable,
              filecoinSubmitQueue,
              ...ipniConfig ? ipniConfig.permissions : [],
              pieceOfferQueue,
              pieceTable,
              rateLimitTable,
              replicaTable,
              revocationTable,
              spaceDiffTable,
              spaceMetricsTable,
              spaceSnapshotTable,
              storeTable,
              // legacy
              storageProviderTable,
              subscriptionTable,
              ucanStream,
              uploadTable
            ],
            environment: {
              ACCESS_SERVICE_URL: getServiceURL(stack, customDomain) ?? "",
              ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName,
              AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
              AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
              AGGREGATOR_DID,
              ALLOCATION_TABLE_NAME: allocationTable.tableName,
              BLOB_REGISTRY_TABLE_NAME: blobRegistryTable.tableName,
              CONSUMER_TABLE_NAME: consumerTable.tableName,
              CONTENT_CLAIMS_DID,
              CONTENT_CLAIMS_URL,
              CUSTOMER_TABLE_NAME: customerTable.tableName,
              DEAL_TRACKER_DID: process.env.DEAL_TRACKER_DID ?? "",
              DEAL_TRACKER_URL: process.env.DEAL_TRACKER_URL ?? "",
              DELEGATION_BUCKET_NAME: delegationBucket.bucketName,
              DELEGATION_TABLE_NAME: delegationTable.tableName,
              DMAIL_API_URL: process.env.DMAIL_API_URL ?? "",
              DID: process.env.UPLOAD_API_DID ?? "",
              DISABLE_IPNI_PUBLISHING,
              ENABLE_CUSTOMER_TRIAL_PLAN: process.env.ENABLE_CUSTOMER_TRIAL_PLAN ?? "false",
              EGRESS_TRAFFIC_QUEUE_URL: egressTrafficQueue.queueUrl,
              FILECOIN_SUBMIT_QUEUE_URL: filecoinSubmitQueue.queueUrl,
              INDEXING_SERVICE_DID,
              INDEXING_SERVICE_URL,
              ...ipniConfig ? ipniConfig.environment : {},
              MAX_REPLICAS: process.env.MAX_REPLICAS ?? "",
              PIECE_OFFER_QUEUE_URL: pieceOfferQueue.queueUrl,
              PIECE_TABLE_NAME: pieceTable.tableName,
              POSTMARK_TOKEN: process.env.POSTMARK_TOKEN ?? "",
              PRINCIPAL_MAPPING: process.env.PRINCIPAL_MAPPING ?? "",
              PROVIDERS: process.env.PROVIDERS ?? "",
              R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? "",
              R2_CARPARK_BUCKET_NAME: process.env.R2_CARPARK_BUCKET_NAME ?? "",
              R2_DELEGATION_BUCKET_NAME: process.env.R2_DELEGATION_BUCKET_NAME ?? "",
              R2_ENDPOINT: process.env.R2_ENDPOINT ?? "",
              R2_REGION: process.env.R2_REGION ?? "",
              R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? "",
              RATE_LIMIT_TABLE_NAME: rateLimitTable.tableName,
              REPLICA_TABLE_NAME: replicaTable.tableName,
              REQUIRE_PAYMENT_PLAN: process.env.REQUIRE_PAYMENT_PLAN ?? "",
              REVOCATION_TABLE_NAME: revocationTable.tableName,
              SPACE_DIFF_TABLE_NAME: spaceDiffTable.tableName,
              SPACE_METRICS_TABLE_NAME: spaceMetricsTable.tableName,
              SPACE_SNAPSHOT_TABLE_NAME: spaceSnapshotTable.tableName,
              STORAGE_PROVIDER_TABLE_NAME: storageProviderTable.tableName,
              STORE_BUCKET_NAME: carparkBucket.bucketName,
              STORE_TABLE_NAME: storeTable.tableName,
              SUBSCRIPTION_TABLE_NAME: subscriptionTable.tableName,
              UCAN_LOG_STREAM_NAME: ucanStream.streamName,
              UPLOAD_API_ALIAS: process.env.UPLOAD_API_ALIAS ?? "",
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? "",
              UPLOAD_SERVICE_URL: getServiceURL(stack, customDomain) ?? "",
              UPLOAD_TABLE_NAME: uploadTable.tableName
            },
            bind: [
              contentClaimsPrivateKey,
              indexingServiceProof,
              privateKey,
              stripeSecretKey,
              dmailApiKey,
              dmailApiSecret,
              dmailJwtSecret
            ]
          }
        },
        "POST /ucan": {
          function: {
            handler: "upload-api/functions/ucan.handler",
            permissions: [agentIndexBucket, agentMessageBucket, ucanStream],
            environment: {
              AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
              AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
              UCAN_LOG_STREAM_NAME: ucanStream.streamName
            },
            bind: [ucanInvocationPostbasicAuth]
          }
        },
        "POST /bridge": {
          function: {
            handler: "upload-api/functions/bridge.handler",
            environment: {
              ACCESS_SERVICE_URL: getServiceURL(stack, customDomain) ?? "",
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? ""
            }
          }
        },
        "GET /": {
          function: {
            handler: "upload-api/functions/get.home",
            environment: {
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? ""
            },
            bind: [privateKey]
          }
        },
        "GET /validate-email": {
          function: {
            handler: "upload-api/functions/validate-email.preValidateEmail",
            environment: {
              HOSTED_ZONE: hostedZone ?? ""
            }
          }
        },
        "POST /validate-email": {
          function: {
            handler: "upload-api/functions/validate-email.validateEmail",
            permissions: [
              agentIndexBucket,
              agentMessageBucket,
              consumerTable,
              customerTable,
              delegationTable,
              delegationBucket,
              egressTrafficQueue,
              egressTrafficTable,
              rateLimitTable,
              revocationTable,
              spaceMetricsTable,
              spaceDiffTable,
              spaceSnapshotTable,
              subscriptionTable,
              ucanStream
            ],
            environment: {
              ACCESS_SERVICE_URL: getServiceURL(stack, customDomain) ?? "",
              AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
              AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
              CONSUMER_TABLE_NAME: consumerTable.tableName,
              CUSTOMER_TABLE_NAME: customerTable.tableName,
              DELEGATION_TABLE_NAME: delegationTable.tableName,
              DELEGATION_BUCKET_NAME: delegationBucket.bucketName,
              EGRESS_TRAFFIC_QUEUE_URL: egressTrafficQueue.queueUrl,
              HOSTED_ZONE: hostedZone ?? "",
              POSTMARK_TOKEN: process.env.POSTMARK_TOKEN ?? "",
              PROVIDERS: process.env.PROVIDERS ?? "",
              RATE_LIMIT_TABLE_NAME: rateLimitTable.tableName,
              R2_ENDPOINT: process.env.R2_ENDPOINT ?? "",
              R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? "",
              R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? "",
              R2_REGION: process.env.R2_REGION ?? "",
              R2_DELEGATION_BUCKET_NAME: process.env.R2_DELEGATION_BUCKET_NAME ?? "",
              REFERRALS_ENDPOINT: process.env.REFERRALS_ENDPOINT ?? "",
              REVOCATION_TABLE_NAME: revocationTable.tableName,
              SPACE_DIFF_TABLE_NAME: spaceDiffTable.tableName,
              SPACE_METRICS_TABLE_NAME: spaceMetricsTable.tableName,
              SPACE_SNAPSHOT_TABLE_NAME: spaceSnapshotTable.tableName,
              STRIPE_FREE_TRIAL_PRICING_TABLE_ID: process.env.STRIPE_FREE_TRIAL_PRICING_TABLE_ID ?? "",
              STRIPE_PRICING_TABLE_ID: process.env.STRIPE_PRICING_TABLE_ID ?? "",
              STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
              SUBSCRIPTION_TABLE_NAME: subscriptionTable.tableName,
              UCAN_LOG_STREAM_NAME: ucanStream.streamName,
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? ""
            },
            bind: [privateKey]
          }
        },
        "GET /error": "upload-api/functions/get.error",
        "GET /version": {
          function: {
            handler: "upload-api/functions/get.version",
            environment: {
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? ""
            },
            bind: [privateKey]
          }
        },
        "GET /.well-known/did.json": {
          function: {
            handler: "upload-api/functions/get.didDocument",
            environment: {
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? "",
              UPLOAD_API_ALIAS: process.env.UPLOAD_API_ALIAS ?? "",
              UPLOAD_API_DEPRECATED_DIDS: process.env.UPLOAD_API_DEPRECATED_DIDS ?? ""
            },
            bind: [privateKey]
          }
        },
        "GET /receipt/{taskCid}": {
          function: {
            handler: "upload-api/functions/receipt.handler",
            permissions: [agentIndexBucket, agentMessageBucket],
            environment: {
              AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
              AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName
            }
          }
        },
        "GET /storefront-cron": {
          function: {
            handler: "upload-api/functions/storefront-cron.handler",
            permissions: [agentIndexBucket, agentMessageBucket, pieceTable],
            environment: {
              AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
              AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
              AGGREGATOR_DID,
              DID: process.env.UPLOAD_API_DID ?? "",
              PIECE_TABLE_NAME: pieceTable.tableName
            },
            bind: [privateKey]
          }
        },
        "GET /metrics": {
          function: {
            handler: "upload-api/functions/metrics.handler",
            permissions: [adminMetricsTable],
            environment: {
              ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName
            }
          }
        },
        // AWS API Gateway does not know trailing slash... and Grafana Agent puts trailing slash
        "GET /metrics/{proxy+}": {
          function: {
            handler: "upload-api/functions/metrics.handler",
            permissions: [adminMetricsTable],
            environment: {
              ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName
            }
          }
        },
        "GET /sample": {
          function: {
            handler: "upload-api/functions/sample.handler",
            permissions: [uploadTable],
            environment: {
              UPLOAD_TABLE_NAME: uploadTable.tableName
            }
          }
        },
        "GET /revocations/{cid}": {
          function: {
            handler: "upload-api/functions/revocations-check.handler",
            permissions: [revocationTable],
            environment: {
              REVOCATION_TABLE_NAME: revocationTable.tableName,
              DELEGATION_BUCKET_NAME: delegationBucket.bucketName
            }
          }
        },
        "GET /oauth/callback": {
          function: {
            handler: "upload-api/functions/oauth-callback.handler",
            permissions: [
              agentIndexBucket,
              agentMessageBucket,
              customerTable,
              ucanStream
            ],
            environment: {
              AGENT_INDEX_BUCKET_NAME: agentIndexBucket.bucketName,
              AGENT_MESSAGE_BUCKET_NAME: agentMessageBucket.bucketName,
              CUSTOMER_TABLE_NAME: customerTable.tableName,
              GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? "",
              UCAN_LOG_STREAM_NAME: ucanStream.streamName,
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? "",
              UPLOAD_SERVICE_URL: getServiceURL(stack, customDomain) ?? ""
            },
            bind: [githubClientSecret, privateKey]
          }
        },
        "GET /oauth/humanode/callback": {
          function: {
            handler: "upload-api/functions/oauth-humanode-callback.handler",
            permissions: [customerTable, humanodeTable],
            environment: {
              CUSTOMER_TABLE_NAME: customerTable.tableName,
              HUMANODE_CLIENT_ID: process.env.HUMANODE_CLIENT_ID ?? "",
              HUMANODE_TABLE_NAME: humanodeTable.tableName,
              HUMANODE_TOKEN_ENDPOINT: process.env.HUMANODE_TOKEN_ENDPOINT ?? "",
              UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? ""
            },
            bind: [humanodeClientSecret, privateKey]
          }
        }
      },
      accessLog: {
        format: '{"requestTime":"$context.requestTime","requestId":"$context.requestId","httpMethod":"$context.httpMethod","path":"$context.path","routeKey":"$context.routeKey","status":$context.status,"responseLatency":$context.responseLatency,"integrationRequestId":"$context.integration.requestId","integrationStatus":"$context.integration.status","integrationLatency":"$context.integration.latency","integrationServiceStatus":"$context.integration.integrationStatus","ip":"$context.identity.sourceIp","userAgent":"$context.identity.userAgent"}'
      },
      cors: {
        allowHeaders: ["*"],
        allowMethods: ["ANY"],
        allowOrigins: ["*"],
        maxAge: "1 day"
      }
    });
  });
  const uploadAdminMetricsDLQ = new Queue7(stack, "upload-admin-metrics-dlq");
  const uploadAdminMetricsConsumer = new Function4(
    stack,
    "upload-admin-metrics-consumer",
    {
      environment: {
        ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName,
        STORE_BUCKET_NAME: carparkBucket.bucketName,
        ALLOCATION_TABLE_NAME: allocationTable.tableName
      },
      permissions: [adminMetricsTable, carparkBucket, allocationTable],
      handler: "upload-api/functions/admin-metrics.consumer",
      deadLetterQueue: uploadAdminMetricsDLQ.cdk.queue
    }
  );
  const uploadSpaceMetricsDLQ = new Queue7(stack, "upload-space-metrics-dlq");
  const uploadSpaceMetricsConsumer = new Function4(
    stack,
    "upload-space-metrics-consumer",
    {
      environment: {
        SPACE_METRICS_TABLE_NAME: spaceMetricsTable.tableName,
        STORE_BUCKET_NAME: carparkBucket.bucketName,
        ALLOCATION_TABLE_NAME: allocationTable.tableName
      },
      permissions: [spaceMetricsTable, carparkBucket, allocationTable],
      handler: "upload-api/functions/space-metrics.consumer",
      deadLetterQueue: uploadSpaceMetricsDLQ.cdk.queue
    }
  );
  ucanStream.addConsumers(stack, {
    uploadAdminMetricsConsumer: {
      function: uploadAdminMetricsConsumer,
      cdk: {
        eventSource: {
          ...getEventSourceConfig(stack),
          batchSize: 25,
          // Override where to begin consuming the stream to latest as we already are reading from this stream
          startingPosition: StartingPosition4.LATEST,
          filters: [
            FilterCriteria2.filter({
              data: {
                type: FilterRule2.isEqual("receipt")
              }
            })
          ]
        }
      }
    },
    uploadSpaceMetricsConsumer: {
      function: uploadSpaceMetricsConsumer,
      cdk: {
        eventSource: {
          ...getEventSourceConfig(stack),
          batchSize: 25,
          // Override where to begin consuming the stream to latest as we already are reading from this stream
          startingPosition: StartingPosition4.LATEST,
          filters: [
            FilterCriteria2.filter({
              data: {
                type: FilterRule2.isEqual("receipt")
              }
            })
          ]
        }
      }
    }
  });
  stack.addOutputs({
    ApiEndpoints: JSON.stringify(apis.map((api) => api.url)),
    CustomDomains: customDomains ? JSON.stringify(
      customDomains.map(
        (customDomain) => `https://${customDomain?.domainName}`
      )
    ) : "Set HOSTED_ZONES in env to deploy to a custom domain"
  });
}
__name(UploadApiStack, "UploadApiStack");

// stacks/replicator-stack.js
import {
  Function as Function5,
  Queue as Queue8,
  use as use5
} from "sst/constructs";
import { Duration as Duration5, aws_events as awsEvents2 } from "aws-cdk-lib";
function ReplicatorStack({ stack, app }) {
  setupSentry(app, stack);
  const { eventBus } = use5(BusStack);
  const carparkReplicatorHandler = new Function5(
    stack,
    "carpark-replicator-handler",
    {
      environment: {
        REPLICATOR_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || "",
        REPLICATOR_ENDPOINT: process.env.R2_ENDPOINT || "",
        REPLICATOR_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || "",
        REPLICATOR_BUCKET_NAME: process.env.R2_CARPARK_BUCKET_NAME || ""
      },
      permissions: ["s3:*"],
      handler: "replicator/functions/replicator.handler",
      timeout: 15 * 60
    }
  );
  const carReplicatorQueue = new Queue8(stack, "car-replicator-queue", {
    consumer: {
      function: carparkReplicatorHandler,
      cdk: {
        eventSource: {
          batchSize: 1
        }
      }
    },
    cdk: {
      queue: {
        // Needs to be set as less or equal than consumer function
        visibilityTimeout: Duration5.seconds(15 * 60)
      }
    }
  });
  const targetMessage = awsEvents2.RuleTargetInput.fromObject({
    bucketRegion: awsEvents2.EventField.fromPath("$.detail.region"),
    bucketName: awsEvents2.EventField.fromPath("$.detail.bucketName"),
    key: awsEvents2.EventField.fromPath("$.detail.key")
  });
  const carTargetReplicatorQueue = {
    type: "queue",
    queue: carReplicatorQueue,
    cdk: {
      target: {
        message: targetMessage
      }
    }
  };
  eventBus.addRules(stack, {
    newCarToReplicate: {
      pattern: {
        source: [CARPARK_EVENT_BRIDGE_SOURCE_EVENT]
      },
      targets: {
        carTargetReplicatorQueue
      }
    }
  });
}
__name(ReplicatorStack, "ReplicatorStack");

// stacks/firehose-stack.js
import { Bucket as Bucket4, use as use6 } from "sst/constructs";
import {
  Aws,
  Duration as Duration6,
  aws_iam as iam,
  aws_logs as logs,
  aws_kinesisfirehose as firehose,
  aws_glue as glue,
  aws_athena as athena,
  aws_sam as sam
} from "aws-cdk-lib";
function UcanFirehoseStack({ stack, app }) {
  setupSentry(app, stack);
  const { ucanStream } = use6(UcanInvocationStack);
  const streamLogBucket = new Bucket4(stack, "stream-log-store", {
    cors: true,
    cdk: {
      bucket: {
        ...getBucketConfig("stream-log-store", app.stage, app.name),
        lifecycleRules: [
          // disable this for now - maybe we do want lifecycle rules eventually but we DEFINITELY don't want to expire these logs!
          // {
          //   enabled: true,
          //   expiration: Duration.days(90)
          // }
        ]
      }
    }
  });
  const deliveryStreamRoleName = getCdkNames("ucan-stream-delivery-role", app.stage, app.name);
  const deliveryStreamRole = new iam.Role(stack, deliveryStreamRoleName, {
    assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    roleName: deliveryStreamRoleName
  });
  const logGroupName = getCdkNames("ucan-stream-delivery-error-logging", app.stage, app.name);
  const cfnLogGroup = new logs.CfnLogGroup(stack, logGroupName, {
    retentionInDays: 90,
    logGroupName
  });
  ucanStream.cdk.stream.grantRead(deliveryStreamRole);
  const policyName = getCdkNames("ucan-stream-delivery-policy", app.stage, app.name);
  new iam.Policy(stack, policyName, {
    policyName,
    roles: [deliveryStreamRole],
    statements: [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [ucanStream.streamArn],
        actions: [
          "kinesis:DescribeStream",
          "kinesis:GetShardIterator",
          "kinesis:GetRecords"
        ]
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [
          streamLogBucket.bucketArn,
          `${streamLogBucket.bucketArn}/*`
        ],
        actions: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:PutObject",
          "s3:PutObjectAcl"
        ]
      }),
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [cfnLogGroup.attrArn],
        actions: [
          "logs:PutLogEvents"
        ]
      })
    ]
  });
  const deliveryStreamName = getCdkNames("ucan-stream-delivery", app.stage, app.name);
  const deliveryFirehose = new firehose.CfnDeliveryStream(stack, deliveryStreamName, {
    deliveryStreamName,
    deliveryStreamType: "KinesisStreamAsSource",
    kinesisStreamSourceConfiguration: {
      kinesisStreamArn: ucanStream.streamArn,
      roleArn: deliveryStreamRole.roleArn
    },
    extendedS3DestinationConfiguration: {
      bucketArn: streamLogBucket.bucketArn,
      roleArn: deliveryStreamRole.roleArn,
      bufferingHints: {
        intervalInSeconds: 60
      },
      // makes easier to run high performance, cost efficient analytics with Athena
      dynamicPartitioningConfiguration: {
        enabled: true
      },
      processingConfiguration: {
        enabled: true,
        processors: [
          {
            type: "MetadataExtraction",
            parameters: [
              {
                parameterName: "MetadataExtractionQuery",
                // extract yyyy-MM-dd formatted current date from millisecond epoch timestamp "ts" using jq syntax
                // extract type ('workflow' or 'receipt')
                // extract the UCAN ability of the invocation to a key named "op" - this matches the latest UCAN spec https://github.com/ucan-wg/invocation/pull/21/files#diff-b335630551682c19a781afebcf4d07bf978fb1f8ac04c6bf87428ed5106870f5R208
                //   we replace / with _ here since it will be used in the S3 bucket path and we a) don't want it to collide with the path separator and b) want it to be easy to refer to in queries
                // eslint-disable-next-line no-useless-escape
                parameterValue: '{day: (.ts/1000) | strftime("%Y-%m-%d"), type: .type, op: (.value.att[0].can | gsub("/"; "_"))}'
              },
              {
                parameterName: "JsonParsingEngine",
                parameterValue: "JQ-1.6"
              }
            ]
          },
          {
            type: "AppendDelimiterToRecord",
            parameters: [
              {
                parameterName: "Delimiter",
                parameterValue: "\\n"
              }
            ]
          }
        ]
      },
      // See https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for general information on partitioning.
      // Daily partitions seem right (https://www.upsolver.com/blog/partitioning-data-s3-improve-performance-athena-presto)
      // "A rough rule of thumb is that each 100 partitions scanned adds about 1 second of latency to your query in Amazon Athena. This is why minutely or hourly
      // partitions are rarely used – typically you would choose between daily, weekly, and monthly partitions, depending on the nature of your queries."
      // We also partition by "type" (workflow or receipt) and "op" (the invoked UCAN ability name):
      //  1) Receipts generally have all the information workflows have so we can safely ignore workflows. 
      //  2) Partitioning by "op" lets us ignore large classes of operations that we don't care about and should
      //     make queries significantly more efficient.
      prefix: "logs/!{partitionKeyFromQuery:type}/!{partitionKeyFromQuery:op}/!{partitionKeyFromQuery:day}/",
      errorOutputPrefix: "error"
    }
  });
  deliveryFirehose.node.addDependency(deliveryStreamRole);
  const databaseName = getCdkNames("ucan-stream-delivery-database", app.stage, app.name);
  const glueDatabase = new glue.CfnDatabase(stack, databaseName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseInput: {
      name: databaseName
    }
  });
  const receiptTableName = getCdkNames("ucan-receipt-table", app.stage, app.name);
  const receiptTable = new glue.CfnTable(stack, receiptTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: receiptTableName,
      partitionKeys: [
        { name: "day", type: "date" },
        { name: "op", type: "string" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "projection.op.type": "enum",
        "projection.op.values": "access_authorize,access_claim,access_delegate,access_session,admin_store_inspect,admin_upload_inspect,aggregate_accept,aggregate_offer,deal_info,consumer_get,consumer_has,customer_get,filecoin_accept,filecoin_info,filecoin_offer,filecoin_submit,piece_accept,piece_offer,provider_add,rate-limit_add,rate-limit_list,rate-limit_remove,space_info,store_add,store_remove,subscription_get,ucan_revoke,upload_add,upload_list,upload_remove,space_blob_add,web3.storage_blob_allocate,web3.storage_blob_accept,",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/\${op}/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRING>>,iss:STRING,aud:STRING>" },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING,message:STRING>,ok:STRING>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  receiptTable.addDependsOn(glueDatabase);
  const storeAddTableName = getCdkNames("store-add-table", app.stage, app.name);
  const storeAddTable = new glue.CfnTable(stack, storeAddTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: storeAddTableName,
      partitionKeys: [
        { name: "day", type: "date" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/store_add/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/store_add/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<size:BIGINT,link:STRUCT<_cid_slash:STRING>>>>,iss:STRING,aud:STRING>" },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<status:STRING,link:STRUCT<_cid_slash:STRING>>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  storeAddTable.addDependsOn(glueDatabase);
  const spaceBlobAddTableName = getCdkNames("space-blob-add-table", app.stage, app.name);
  const spaceBlobAddTable = new glue.CfnTable(stack, spaceBlobAddTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: spaceBlobAddTableName,
      partitionKeys: [
        { name: "day", type: "date" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/space_blob_add/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/space_blob_add/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<blob:STRUCT<size:BIGINT>>>>,iss:STRING,aud:STRING>" },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<site:STRING>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  spaceBlobAddTable.addDependsOn(glueDatabase);
  const blobAllocateTableName = getCdkNames("blob-allocate-table", app.stage, app.name);
  const blobAllocateTable = new glue.CfnTable(stack, blobAllocateTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: blobAllocateTableName,
      partitionKeys: [
        { name: "day", type: "date" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/web3.storage_blob_allocate/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/web3.storage_blob_allocate/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<blob:STRUCT<size:BIGINT>,space:STRING,cause:STRUCT<_cid_slash:STRING>>>>,iss:STRING,aud:STRING>" },
          // No need to store URL for allocation here for now
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<size:BIGINT>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  blobAllocateTable.addDependsOn(glueDatabase);
  const blobAcceptTableName = getCdkNames("blob-accept-table", app.stage, app.name);
  const blobAcceptTable = new glue.CfnTable(stack, blobAcceptTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: blobAcceptTableName,
      partitionKeys: [
        { name: "day", type: "date" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/web3.storage_blob_accept/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/web3.storage_blob_accept/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<blob:STRUCT<size:BIGINT>,space:STRING>>>,iss:STRING,aud:STRING>" },
          // No need to store URL for allocation here for now
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<site:STRUCT<_cid_slash:STRING>>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  blobAcceptTable.addDependsOn(glueDatabase);
  const uploadAddTableName = getCdkNames("upload-add-table", app.stage, app.name);
  const uploadAddTable = new glue.CfnTable(stack, uploadAddTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: uploadAddTableName,
      partitionKeys: [
        { name: "day", type: "date" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/upload_add/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/upload_add/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<STRUCT<can:STRING,with:STRING,nb:STRUCT<root:STRUCT<_cid_slash:STRING>,shards:ARRAY<STRUCT<_cid_slash:STRING>>>>>,iss:STRING,aud:STRING>" },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<root:STRUCT<_cid_slash:STRING>,shards:ARRAY<STRUCT<_cid_slash:STRING>>>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  uploadAddTable.addDependsOn(glueDatabase);
  const storeRemoveTableName = getCdkNames("store-remove-table", app.stage, app.name);
  const storeRemoveTable = new glue.CfnTable(stack, storeRemoveTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: storeRemoveTableName,
      partitionKeys: [
        { name: "day", type: "date" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/store_remove/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/store_remove/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<link:STRUCT<_cid_slash:STRING>>>>,iss:STRING,aud:STRING>" },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<size:BIGINT>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  storeRemoveTable.addDependsOn(glueDatabase);
  const blobRemoveTableName = getCdkNames("blob-remove-table", app.stage, app.name);
  const blobRemoveTable = new glue.CfnTable(stack, blobRemoveTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: blobRemoveTableName,
      partitionKeys: [
        { name: "day", type: "date" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/blob_remove/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/blob_remove/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<digest:BINARY>>>,iss:STRING,aud:STRING>" },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<size:BIGINT>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  blobRemoveTable.addDependsOn(glueDatabase);
  const uploadRemoveTableName = getCdkNames("upload-remove-table", app.stage, app.name);
  const uploadRemoveTable = new glue.CfnTable(stack, uploadRemoveTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: uploadRemoveTableName,
      partitionKeys: [
        { name: "day", type: "date" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/upload_remove/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/upload_remove/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<STRUCT<can:STRING,with:STRING,nb:STRUCT<root:STRUCT<_cid_slash:STRING>,shards:ARRAY<STRUCT<_cid_slash:STRING>>>>>,iss:STRING,aud:STRING>" },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<root:STRUCT<_cid_slash:STRING>,shards:ARRAY<STRUCT<_cid_slash:STRING>>>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  uploadRemoveTable.addDependsOn(glueDatabase);
  const providerAddTableName = getCdkNames("provider-add-table", app.stage, app.name);
  const providerAddTable = new glue.CfnTable(stack, providerAddTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: providerAddTableName,
      partitionKeys: [
        { name: "day", type: "date" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/provider_add/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/provider_add/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<provider:STRING,consumer:STRING>>>,iss:STRING,aud:STRING>" },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<root:STRUCT<_cid_slash:STRING>>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  providerAddTable.addDependsOn(glueDatabase);
  const aggregateOfferTableName = getCdkNames("aggregate-offer-table", app.stage, app.name);
  const aggregateOfferTable = new glue.CfnTable(stack, aggregateOfferTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: aggregateOfferTableName,
      partitionKeys: [
        { name: "day", type: "date" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/aggregate_offer/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/aggregate_offer/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<aggregate:STRUCT<_cid_slash:STRING>>>>,iss:STRING,aud:STRING>" },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<aggregate:STRUCT<_cid_slash:STRING>>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  aggregateOfferTable.addDependsOn(glueDatabase);
  const aggregateAcceptTableName = getCdkNames("aggregate-accept-table", app.stage, app.name);
  const aggregateAcceptTable = new glue.CfnTable(stack, aggregateAcceptTableName, {
    catalogId: Aws.ACCOUNT_ID,
    databaseName,
    tableInput: {
      name: aggregateAcceptTableName,
      partitionKeys: [
        { name: "day", type: "date" }
      ],
      parameters: {
        classification: "json",
        typeOfData: "file",
        // @see https://docs.aws.amazon.com/athena/latest/ug/partition-projection-kinesis-firehose-example.html for more information on projection
        // configuration - this should match the "day" parameter and S3 prefix configured in the delivery stream
        "projection.enabled": "true",
        "projection.day.type": "date",
        "projection.day.format": "yyyy-MM-dd",
        "projection.day.range": "2023-01-01,NOW",
        "projection.day.interval": "1",
        "projection.day.interval.unit": "DAYS",
        "storage.location.template": `s3://${streamLogBucket.bucketName}/logs/receipt/aggregate_accept/\${day}/`
      },
      storageDescriptor: {
        location: `s3://${streamLogBucket.bucketName}/logs/receipt/aggregate_accept/`,
        columns: [
          { name: "carcid", type: "string" },
          // STRUCT here refers to the Apache Hive STRUCT datatype - see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
          { name: "value", type: "STRUCT<att:ARRAY<struct<can:STRING,with:STRING,nb:STRUCT<aggregate:STRUCT<_cid_slash:STRING>>>>,iss:STRING,aud:STRING>" },
          { name: "out", type: "STRUCT<error:STRUCT<name:STRING>,ok:STRUCT<aggregate:STRUCT<_cid_slash:STRING>>>" },
          { name: "ts", type: "timestamp" }
        ],
        inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
        outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        serdeInfo: {
          serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
          parameters: {
            // see https://aws.amazon.com/blogs/big-data/create-tables-in-amazon-athena-from-nested-json-and-mappings-using-jsonserde/
            "mapping._cid_slash": "/"
          }
        }
      }
    }
  });
  aggregateAcceptTable.addDependsOn(glueDatabase);
  const athenaResultsBucket = new Bucket4(stack, "athena-w3up-results", {
    cors: true,
    cdk: {
      bucket: {
        ...getBucketConfig("athena-w3up-results", app.stage, app.name),
        lifecycleRules: [{
          enabled: true,
          expiration: Duration6.days(7)
        }]
      }
    }
  });
  const workgroupName = getCdkNames("w3up", app.stage, app.name);
  const workgroup = new athena.CfnWorkGroup(stack, workgroupName, {
    name: workgroupName,
    workGroupConfiguration: {
      resultConfiguration: {
        outputLocation: `s3://${athenaResultsBucket.bucketName}`
      }
    }
  });
  const inputOutputQueryName = getCdkNames("input-output-query", app.stage, app.name);
  const inputOutputQuery = new athena.CfnNamedQuery(stack, inputOutputQueryName, {
    name: "Inputs and Outputs, last 24 hours",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `SELECT 
  value.att[1] as "in",
  out
FROM "AwsDataCatalog"."${databaseName}"."${receiptTableName}"
WHERE day >= (CURRENT_DATE - INTERVAL '1' DAY)
`
  });
  inputOutputQuery.addDependsOn(workgroup);
  inputOutputQuery.addDependsOn(receiptTable);
  const dataStoredQueryName = getCdkNames("data-stored-query", app.stage, app.name);
  const dataStoredQuery = new athena.CfnNamedQuery(stack, dataStoredQueryName, {
    name: "Data stored by space, past 7 days",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `SELECT
  SUM(value.att[1].nb.size) AS size,
  value.att[1]."with" AS space
FROM "AwsDataCatalog"."${databaseName}"."${storeAddTableName}"
WHERE out.ok IS NOT NULL
  AND day >= (CURRENT_DATE - INTERVAL '7' DAY)
GROUP BY value.att[1]."with"
`
  });
  dataStoredQuery.addDependsOn(workgroup);
  dataStoredQuery.addDependsOn(storeAddTable);
  const storesBySpaceQueryName = getCdkNames("stores-by-space-query", app.stage, app.name);
  const storesBySpaceQuery = new athena.CfnNamedQuery(stack, storesBySpaceQueryName, {
    name: "Stores, past 7 days",
    description: `${app.stage} w3up preload
    
Recent uploaded CARs by Customer email and CID`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
spaces AS (
  SELECT value.att[1].nb.consumer AS did,
  value.att[1]."with" AS account
  FROM "AwsDataCatalog"."${databaseName}"."${providerAddTableName}"  
  WHERE out.ok IS NOT NULL 
), 
stores AS (
  SELECT value.att[1].nb.link._cid_slash AS cid,
         value.att[1]."with" AS space,
         ts
  FROM "AwsDataCatalog"."${databaseName}"."${storeAddTableName}" 
  WHERE out.ok IS NOT NULL
    -- query by both day and ts because day engages partitioning and ts filters out data on the first day in the range
    AND day >= (CURRENT_DATE - INTERVAL '7' DAY)
    AND ts >= (CURRENT_TIMESTAMP - INTERVAL '7' DAY)
),
stores_by_account AS (
  SELECT stores.cid AS cid,
         spaces.account AS account,
         spaces.did AS space, 
         stores.ts AS ts
  FROM stores LEFT JOIN spaces on spaces.did = stores.space
) SELECT * 
  FROM stores_by_account 
  ORDER BY ts
`
  });
  storesBySpaceQuery.addDependsOn(workgroup);
  storesBySpaceQuery.addDependsOn(providerAddTable);
  storesBySpaceQuery.addDependsOn(storeAddTable);
  const uploadsQueryName = getCdkNames("uploads-query", app.stage, app.name);
  const uploadsQuery = new athena.CfnNamedQuery(stack, uploadsQueryName, {
    name: "Uploads, past 7 days",
    description: `${app.stage} w3up preload
    
Recent uploaded content by Customer email and CID`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
spaces AS (
  SELECT value.att[1].nb.consumer AS did,
  value.att[1]."with" AS account
  FROM "AwsDataCatalog"."${databaseName}"."${providerAddTableName}"  
  WHERE out.ok IS NOT NULL 
), 
uploads AS (
  SELECT value.att[1].nb.root._cid_slash AS cid,
         value.att[1]."with" AS space,
         ts
  FROM "AwsDataCatalog"."${databaseName}"."${uploadAddTableName}" 
  WHERE out.ok IS NOT NULL
    -- query by both day and ts because day engages partitioning and ts filters out data on the first day in the range
    AND day >= (CURRENT_DATE - INTERVAL '7' DAY)
    AND ts >= (CURRENT_TIMESTAMP - INTERVAL '7' DAY)
),
uploads_by_account AS (
  SELECT uploads.cid AS cid,
         spaces.account AS account,
         spaces.did AS space, 
         uploads.ts AS ts
  FROM uploads LEFT JOIN spaces on spaces.did = uploads.space
) SELECT * 
  FROM uploads_by_account 
  ORDER BY ts
  `
  });
  uploadsQuery.addDependsOn(workgroup);
  uploadsQuery.addDependsOn(providerAddTable);
  uploadsQuery.addDependsOn(uploadAddTable);
  const uploadVolumeSizeQueryName = getCdkNames("upload-volume-size-query", app.stage, app.name);
  const uploadVolumeSizeQuery = new athena.CfnNamedQuery(stack, uploadVolumeSizeQueryName, {
    name: "Users with highest upload volume (by size), past day",
    description: `${app.stage} w3up preload
    
Global view of users with most upload volume (by size) in the last 24 hours by their registered email`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
spaces AS (
  SELECT value.att[1].nb.consumer AS did,
         value.att[1]."with" AS account
  FROM "AwsDataCatalog"."${databaseName}"."${providerAddTableName}"  
  WHERE out.ok IS NOT NULL 
), 
stores AS (
  SELECT value.att[1].nb.size AS size,
         value.att[1]."with" AS space
  FROM "AwsDataCatalog"."${databaseName}"."${storeAddTableName}" 
  WHERE out.ok IS NOT NULL
    -- query by both day and ts because day engages partitioning and ts filters out data on the first day in the range
    AND day >= (CURRENT_DATE - INTERVAL '1' DAY)
    AND ts >= (CURRENT_TIMESTAMP - INTERVAL '1' DAY)
),
stores_by_account AS (
  SELECT spaces.account AS account,
         stores.size AS size         
  FROM stores LEFT JOIN spaces on spaces.did = stores.space
) SELECT account, SUM(size) as size
  FROM stores_by_account 
  GROUP BY account
  ORDER BY size DESC
`
  });
  uploadVolumeSizeQuery.addDependsOn(workgroup);
  uploadVolumeSizeQuery.addDependsOn(providerAddTable);
  uploadVolumeSizeQuery.addDependsOn(storeAddTable);
  const uploadVolumeCountQueryName = getCdkNames("upload-volume-count-query", app.stage, app.name);
  const uploadVolumeCountQuery = new athena.CfnNamedQuery(stack, uploadVolumeCountQueryName, {
    name: "Users with highest upload volume (by count), past day",
    description: `${app.stage} w3up preload
    
Global view of users with most upload volume (by count) in the last 24 hours by their registered email`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
spaces AS (
  SELECT value.att[1].nb.consumer AS did,
         value.att[1]."with" AS account
  FROM "AwsDataCatalog"."${databaseName}"."${providerAddTableName}"
  WHERE out.ok IS NOT NULL 
), 
uploads AS (
  SELECT value.att[1].nb.root._cid_slash AS cid,
         value.att[1]."with" AS space,
         1 AS count
  FROM "AwsDataCatalog"."${databaseName}"."${uploadAddTableName}"
  WHERE out.ok IS NOT NULL
    -- query by both day and ts because day engages partitioning and ts filters out data on the first day in the range
    AND day >= (CURRENT_DATE - INTERVAL '1' DAY)
    AND ts >= (CURRENT_TIMESTAMP - INTERVAL '1' DAY)
),
uploads_by_account AS (
  SELECT spaces.account AS account,
         uploads.count AS count
  FROM uploads LEFT JOIN spaces on spaces.did = uploads.space
) SELECT account, SUM(count) as count
  FROM uploads_by_account 
  GROUP BY account
  ORDER BY count DESC
`
  });
  uploadVolumeCountQuery.addDependsOn(workgroup);
  uploadVolumeCountQuery.addDependsOn(providerAddTable);
  uploadVolumeCountQuery.addDependsOn(storeAddTable);
  const uploadsBySpaceAndSizeQueryName = getCdkNames("uploads-by-space-and-size", app.stage, app.name);
  const uploadsBySpaceAndSizeQuery = new athena.CfnNamedQuery(stack, uploadsBySpaceAndSizeQueryName, {
    name: "Uploads by space and size, last 2 days",
    description: `${app.stage} w3up preload
    
Uploads over the last 2 days, with size aggregated from corresponding "store" operations.`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
uploads_by_shard AS (
  SELECT 
    carcid AS id,
    ts,
    uploads.value.att[1]."with" AS space,
    uploads.value.att[1].nb.root._cid_slash AS root,
    shards.cid._cid_slash AS shard
  FROM "AwsDataCatalog"."${databaseName}"."${uploadAddTableName}" AS uploads
  CROSS JOIN UNNEST(uploads.value.att[1].nb.shards) AS shards (cid)
  WHERE uploads.day >= (CURRENT_DATE - INTERVAL '2' DAY)
),
stores_by_size AS (
  SELECT
    carcid AS id,
    ts,
    stores.value.att[1].nb.link._cid_slash AS cid,
    stores.value.att[1].nb.size AS size
  FROM "AwsDataCatalog"."${databaseName}"."${storeAddTableName}" AS stores
  WHERE stores.day >= (CURRENT_DATE - INTERVAL '2' DAY)
),
upload_shards_by_size AS (
  SELECT DISTINCT
    uploads_by_shard.ts AS upload_ts,
    uploads_by_shard.space AS space,
    uploads_by_shard.root AS content_cid,
    stores_by_size.cid AS car_cid,
    stores_by_size.size AS size
  FROM uploads_by_shard JOIN stores_by_size ON uploads_by_shard.shard = stores_by_size.cid
) SELECT  
  upload_ts,
  space,
  content_cid,
  SUM(size) AS size
FROM upload_shards_by_size
WHERE upload_ts >= (CURRENT_TIMESTAMP - INTERVAL '2' DAY)
GROUP BY upload_ts, space, content_cid
ORDER BY upload_ts DESC
`
  });
  uploadsBySpaceAndSizeQuery.addDependsOn(workgroup);
  uploadsBySpaceAndSizeQuery.addDependsOn(uploadAddTable);
  uploadsBySpaceAndSizeQuery.addDependsOn(storeAddTable);
  const aggregateHoursToDataCommitedQueryName = getCdkNames("aggregate-hours-to-data-commited-query", app.stage, app.name);
  const aggregateHoursToDataCommitedQuery = new athena.CfnNamedQuery(stack, aggregateHoursToDataCommitedQueryName, {
    name: "Hours to data commited per aggregate in the last 7 days",
    description: `${app.stage} w3up preload
    
Hours to data commited per aggregate in the last 7 days`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
accepted_aggregates AS (
  SELECT value.att[1].nb.aggregate._cid_slash as cid,
         ts as accept_ts
  FROM "AwsDataCatalog"."${databaseName}"."${aggregateAcceptTableName}"
  WHERE ts >= (CURRENT_TIMESTAMP - INTERVAL '7' DAY)
)
SELECT cid,
       ts as offer_ts,
       accept_ts,
       CAST((to_unixtime(accept_ts) - to_unixtime(ts))/3600 as integer) as hrs_to_data_commited
FROM "AwsDataCatalog"."${databaseName}."${aggregateOfferTableName}"
INNER JOIN accepted_aggregates ON accepted_aggregates.cid = value.att[1].nb.aggregate._cid_slash
`
  });
  aggregateHoursToDataCommitedQuery.addDependsOn(workgroup);
  aggregateHoursToDataCommitedQuery.addDependsOn(aggregateAcceptTable);
  aggregateHoursToDataCommitedQuery.addDependsOn(aggregateOfferTable);
  const athenaDynamoSpillBucket = new Bucket4(stack, "athena-dynamo-spill", {
    cors: true,
    cdk: {
      bucket: {
        ...getBucketConfig("athena-dynamo-spill", app.stage, app.name),
        lifecycleRules: [{
          enabled: true,
          expiration: Duration6.days(1)
        }]
      }
    }
  });
  const dynamoAthenaLambdaName = getCdkNames("dynamo-athena", app.stage, app.name);
  const athenaDynamoConnector = new sam.CfnApplication(stack, getCdkNames("athena-dynamo-connector", app.stage, app.name), {
    // I got this ARN and version from the AWS admin UI after configuring the Athena Dynamo connector manually using these instructions:
    // https://docs.aws.amazon.com/athena/latest/ug/connect-data-source-serverless-app-repo.html
    location: {
      applicationId: "arn:aws:serverlessrepo:us-east-1:292517598671:applications/AthenaDynamoDBConnector",
      semanticVersion: "2023.38.1"
    },
    parameters: {
      AthenaCatalogName: dynamoAthenaLambdaName,
      SpillBucket: athenaDynamoSpillBucket.bucketName
    }
  });
  const dynamoDataCatalogName = getCdkNames("dynamo-data-catalog", app.stage, app.name);
  const dynamoDataCatalogDatabaseName = getCdkNames("dynamo", app.stage, app.name);
  const dynamoDataCatalog = new athena.CfnDataCatalog(stack, dynamoDataCatalogName, {
    name: dynamoDataCatalogDatabaseName,
    type: "LAMBDA",
    parameters: {
      function: `arn:aws:lambda:${stack.region}:${stack.account}:function:${dynamoAthenaLambdaName}`
    }
  });
  dynamoDataCatalog.addDependsOn(athenaDynamoConnector);
  const spacesByAccountQueryName = getCdkNames("spaces-by-account-query", app.stage, app.name);
  const spacesByAccountQuery = new athena.CfnNamedQuery(stack, spacesByAccountQueryName, {
    name: "Dynamo: spaces by account",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `SELECT 
  customer as account,
  consumer as space
FROM "${dynamoDataCatalogDatabaseName}"."default"."${app.stage}-${app.name}-subscription" AS sub 
  LEFT JOIN "${dynamoDataCatalogDatabaseName}"."default"."${app.stage}-${app.name}-consumer" AS space 
  ON space.subscription = sub.subscription
`
  });
  spacesByAccountQuery.addDependsOn(dynamoDataCatalog);
  spacesByAccountQuery.addDependsOn(workgroup);
  const uploadsByAccountQueryName = getCdkNames("uploads-by-account-query", app.stage, app.name);
  const uploadsByAccountQuery = new athena.CfnNamedQuery(stack, uploadsByAccountQueryName, {
    name: "Dynamo: uploads by account",
    description: `${app.stage} w3up preload`,
    database: databaseName,
    workGroup: workgroupName,
    queryString: `WITH 
spaces AS (
  SELECT customer as account,
         consumer as did
  FROM "${dynamoDataCatalogDatabaseName}"."default"."${app.stage}-${app.name}-subscription" AS sub 
  LEFT JOIN "${dynamoDataCatalogDatabaseName}"."default"."${app.stage}-${app.name}-consumer" AS space 
  ON space.subscription = sub.subscription
), 
uploads AS (
  SELECT value.att[1].nb.root._cid_slash AS cid,
         value.att[1]."with" AS space,
         ts
  FROM "AwsDataCatalog"."${databaseName}"."${receiptTableName}" 
  WHERE value.att[1].can='upload/add' 
    AND out.ok IS NOT NULL 
    AND type='receipt'
),
uploads_by_account AS (
  SELECT spaces.did AS space, 
         spaces.account AS account,
         uploads.cid AS cid,
         uploads.ts AS "timestamp"
  FROM uploads LEFT JOIN spaces on spaces.did = uploads.space
) SELECT * 
  FROM uploads_by_account 
  ORDER BY timestamp
`
  });
  uploadsByAccountQuery.addDependsOn(receiptTable);
  uploadsByAccountQuery.addDependsOn(dynamoDataCatalog);
  uploadsByAccountQuery.addDependsOn(workgroup);
}
__name(UcanFirehoseStack, "UcanFirehoseStack");

// stacks/psa-stack.js
import { Function as Function6 } from "sst/constructs";
import { Bucket as Bucket5 } from "aws-cdk-lib/aws-s3";
function PSAStack({ stack }) {
  stack.setDefaultFunctionProps({
    runtime: "nodejs20.x",
    architecture: "arm_64",
    environment: {
      R2_ENDPOINT: process.env.R2_ENDPOINT ?? "",
      R2_REGION: process.env.R2_REGION ?? "",
      R2_CARPARK_BUCKET_NAME: process.env.R2_CARPARK_BUCKET_NAME ?? "",
      R2_DUDEWHERE_BUCKET_NAME: process.env.R2_DUDEWHERE_BUCKET_NAME ?? "",
      R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? "",
      R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? "",
      S3_DOTSTORAGE_0_BUCKET_REGION: process.env.S3_DOTSTORAGE_0_BUCKET_REGION ?? "",
      S3_DOTSTORAGE_0_BUCKET_NAME: process.env.S3_DOTSTORAGE_0_BUCKET_NAME ?? "",
      S3_DOTSTORAGE_1_BUCKET_REGION: process.env.S3_DOTSTORAGE_1_BUCKET_REGION ?? "",
      S3_DOTSTORAGE_1_BUCKET_NAME: process.env.S3_DOTSTORAGE_1_BUCKET_NAME ?? "",
      S3_PICKUP_BUCKET_REGION: process.env.S3_PICKUP_BUCKET_REGION ?? "",
      S3_PICKUP_BUCKET_NAME: process.env.S3_PICKUP_BUCKET_NAME ?? ""
    }
  });
  const buckets = [];
  if (process.env.S3_DOTSTORAGE_0_BUCKET_ARN) {
    buckets.push(Bucket5.fromBucketArn(stack, "dotstorage-0", process.env.S3_DOTSTORAGE_0_BUCKET_ARN));
  }
  if (process.env.S3_DOTSTORAGE_1_BUCKET_ARN) {
    buckets.push(Bucket5.fromBucketArn(stack, "dotstorage-1", process.env.S3_DOTSTORAGE_1_BUCKET_ARN));
  }
  if (process.env.S3_PICKUP_BUCKET_ARN) {
    buckets.push(Bucket5.fromBucketArn(stack, "pickup", process.env.S3_PICKUP_BUCKET_ARN));
  }
  const hashFunction = new Function6(stack, "hash", {
    handler: "psa/functions/hash.handler",
    url: { cors: true, authorizer: "none" },
    memorySize: "4 GB",
    timeout: "15 minutes",
    permissions: buckets
  });
  const downloadFunction = new Function6(stack, "download", {
    handler: "psa/functions/download.handler",
    url: { cors: true, authorizer: "none" },
    permissions: buckets
  });
  stack.addOutputs({
    hashFunctionURL: hashFunction.url,
    downloadFunctionURL: downloadFunction.url
  });
}
__name(PSAStack, "PSAStack");

// sst.config.ts
var getServiceConfig = /* @__PURE__ */ __name(async () => {
  const servicePath = process.env.SEED_SERVICE_PATH;
  if (servicePath) {
    const sstConfig = await import(`./${path.join(".", servicePath, "sst.config.js")}`);
    return sstConfig.default;
  }
}, "getServiceConfig");
var sst_config_default = {
  async config(_input) {
    const sstConfig = await getServiceConfig();
    if (sstConfig)
      return sstConfig.config(_input);
    return {
      name: "w3infra",
      region: "us-west-2"
    };
  },
  async stacks(app) {
    const sstConfig = await getServiceConfig();
    if (sstConfig)
      return sstConfig.stacks(app);
    if (isPrBuild(app.stage)) {
      app.setDefaultRemovalPolicy(RemovalPolicy2.DESTROY);
    }
    app.setDefaultFunctionProps({
      runtime: "nodejs20.x",
      architecture: "arm_64",
      environment: {
        NODE_OPTIONS: "--enable-source-maps"
      },
      nodejs: {
        format: "esm",
        sourcemap: true
      },
      tracing: app.stage === "staging" || isPrBuild(app.stage) ? "active" : "disabled"
    });
    app.stack(PSAStack);
    app.stack(BusStack);
    app.stack(UploadDbStack);
    app.stack(RoundaboutStack);
    app.stack(BillingDbStack);
    app.stack(CarparkStack);
    app.stack(UcanInvocationStack);
    app.stack(BillingStack);
    app.stack(FilecoinStack);
    app.stack(IndexerStack);
    app.stack(UploadApiStack);
    app.stack(ReplicatorStack);
    app.stack(UcanFirehoseStack);
    Tags.of(app).add("Project", "w3infra");
    Tags.of(app).add("Repository", "https://github.com/storacha/w3infra");
    Tags.of(app).add("Environment", `${app.stage}`);
    Tags.of(app).add("ManagedBy", "SST");
  }
};
export {
  sst_config_default as default
};
