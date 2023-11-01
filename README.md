<h1 align="center">⁂<br/>web3.storage</h1>
<p align="center">

The Infra for [w3protocol] 

</p>

A [UCAN] based API to for storing CARs and registering uploads, built on [ucanto] and [SST].

The server-side implementation of the `store/*` and `upload/*` capabilities defined in [w3protocol].

## Getting Started

The repo contains the infra deployment code and the api implementation.

```
├── billing         - usage accounting and reporting to the payment system
├── carpark         - lambda for announce new CARs in the carpark bucket
├── replicator      - lambda to replicate buckets to R2
├── satnav          - lambda to listen for new CARs and write CAR indexes in satnav
├── stacks          - sst and aws cdk code to deploy all the things
├── ucan-invocation - kinesis log data stream and its lambda consumers
└── upload-api      - lambda & dynamoDB implementation of the upload-api http gateway
```

To work on this codebase **you need**:

- Node.js >= v16 (prod env is node v16)
- Install the deps with `npm i`

You can then run the tests locally with `npm test`. 

To try out a change submit a PR and you'll get temporary infra rolled out for you automatically at `https://<pr#>.up.web3.storage`.

[`sst`](https://sst.dev) is the framework we use to define what to deploy. Read the docs! https://sst.dev

## Deployment 

Deployments are managed by [seed.run]. 

The `main` branch is deployed to https://staging.up.web3.storage and staging builds are promoted to prod manually via the UI at https://console.seed.run

### Local dev

You can use `sst` to create a custom dev deployment on aws, with a local dev console for debugging.

To do that **you need**

- An AWS account with the AWS CLI configured locally
- Copy `.env.tpl` to `.env.local`

Then run `npm start` to deploy dev services to your aws account and start dev console

```console
npm start
```

See: https://docs.sst.dev for more info on how things get deployed.

## Package Tests

To run per-package tests, first install Docker Desktop (https://www.docker.com/) and ensure it is running.

Next, ensure the `AWS_REGION`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` environment variables are set in your terminal. They do 
not need to be set to real values - the following works in `bash`-like shells:

```
export AWS_REGION='us-west-2'; export AWS_ACCESS_KEY_ID='NOSUCH'; export AWS_SECRET_ACCESS_KEY='NOSUCH'
```

Finally, to run the tests for all packages, run:

```
npm test
```

Or to run the tests for a single package, run:

```
npm test -w <path/to/package>
```

## Integration tests

Integration tests run by default on post-deploy stage of [seed.run] deployment pipeline. These integration tests will run with the deployed infrastructure for the given stages (PR / staging).

It is also possible to run the integration tests with a development deploy of `sst`. For this, you can run:

```
npm run deploy
npm run test-integration
```

Please notice that appropriate environment variables must be set for the development deploy. For this you are required to setup your `.env.local` file as instructed in Getting started section. You can read more [here](https://gist.github.com/alanshaw/e949abfcf6728f590ac9fa083dba5648) on how to setup CI with a w3account.

### Environment Variables

Ensure the following variables are set in the env when deploying

#### `HOSTED_ZONE`

The root domain to deploy the w3up API to. e.g `up.web3.storage`. The value should match a hosted zone configured in route53 that your aws account has access to.

#### `ROUNDABOUT_HOSTED_ZONE`

The domain to deploy the roundabout API to. e.g `roundabout.web3.storage`. The value should match a hosted zone configured in route53 that your aws account has access to.

#### `ACCESS_SERVICE_URL`

URL of the w3access service.

#### `AGGREGATOR_SERVICE_DID`

DID of the filecoin aggregator service.

#### `AGGREGATOR_SERVICE_URL`

URL of the filecoin aggregator service.

#### `CONTENT_CLAIMS_DID`

DID of the [content claims service](https://github.com/web3-storage/content-claims).

#### `CONTENT_CLAIMS_URL`

URL of the [content claims service](https://github.com/web3-storage/content-claims).

#### `UPLOAD_API_DID`

[DID](https://www.w3.org/TR/did-core/) of the upload-api ucanto server. e.g. `did:web:up.web3.storage`. Optional: if omitted, a `did:key` will be derrived from `PRIVATE_KEY`

#### `R2_ACCESS_KEY_ID`

Access key for S3 like cloud object storage to replicate content into.

#### `R2_SECRET_ACCESS_KEY`

Secret access key for S3 like cloud object storage to replicate content into.

#### `R2_ENDPOINT`

Endpoint for S3 like cloud object storage to replicate content into.

#### `R2_CARPARK_BUCKET_NAME`

Bucket name to replicate written CAR files.

#### `R2_SATNAV_BUCKET_NAME`

Bucket name to replicate written .idx files.

#### `R2_DUDEWHERE_BUCKET_NAME`

Bucket name to replicate root CID to car CIDs mapping.

#### `R2_DELEGATION_BUCKET_NAME`

Bucket name where delegations are stored.

#### `PROVIDERS`

A comma-separated string of ServiceDIDs in use.

#### `SENTRY_DSN`

Data source name for Sentry application monitoring service.

#### `EIPFS_INDEXER_SQS_ARN`

AWS ARN for Elastic IPFS SQS indexer used to request Elastic IPFS to index given CAR files.

#### `EIPFS_INDEXER_SQS_URL`

AWS URL for Elastic IPFS SQS indexer used to request Elastic IPFS to index given CAR files.

#### `POSTMARK_TOKEN`

Postmark API token, which is used by the email verification system to send emails.

#### `MAILSLURP_API_KEY`

API token for [Mailslurp](https://www.mailslurp.com/), which is used in [integration tests](./test/integration.test.js). To invalidate or refresh tokens, head to the [Mailslurp dashboard](https://app.mailslurp.com/dashboard/).

### Secrets

Set production secrets in aws SSM via [`sst secrets`](https://docs.sst.dev/config#sst-secrets). The region must be set to the one you deploy that stage to

```sh
# set `PRIVATE_KEY` for prod
$ npx sst secrets set --region us-west-2 --stage prod PRIVATE_KEY "MgCblCY...="
```

To set a fallback value for `staging` or an ephmeral PR build use [`sst secrets set-fallback`](https://docs.sst.dev/config#fallback-values)

```sh
# set `PRIVATE_KEY` for any stage in us-east-2
$ npx sst secrets set-fallback --region us-east-2 PRIVATE_KEY "MgCZG7...="
```

**note** The fallback value can only be inherited by stages deployed in the same AWS account and region.

Confirm the secret value using [`sst secrets list`](https://docs.sst.dev/config#sst-secrets)

```sh
$ npx sst secrets list --region us-east-2
PRIVATE_KEY MgCZG7...= (fallback)

$ npx sst secrets list --region us-west-2 --stage prod
PRIVATE_KEY M...=
```

#### `PRIVATE_KEY`

The [`multibase`](https://github.com/multiformats/multibase) encoded ED25519 keypair used as the signing key for the upload-api.

Generated by [@ucanto/principal `EdSigner`](https://github.com/web3-storage/ucanto) via [`ucan-key`](https://www.npmjs.com/package/ucan-key)

_Example:_ `MgCZG7EvaA...1pX9as=`

#### `CONTENT_CLAIMS_PRIVATE_KEY`

The `base64pad` [`multibase`](https://github.com/multiformats/multibase) encoded ED25519 keypair used as the signing key for [content-claims](https://github.com/web3-storage/content-claims).

Generated by [@ucanto/principal `EdSigner`](https://github.com/web3-storage/ucanto) via [`ucan-key`](https://www.npmjs.com/package/ucan-key)

_Example:_ `MgCZG7EvaA...1pX9as=`

#### `UCAN_INVOCATION_POST_BASIC_AUTH`

The HTTP Basic auth token for the UCAN Invocation entrypoint, where UCAN invocations can be stored and proxied to the UCAN Stream.

_Example:_ `MgCZG7EvaA...1pX9as=`

#### `STRIPE_SECRET_KEY`

Stripe API key for reporting per customer usage.

## HTTP API

A UCAN based [RPC] API over HTTP.

### `POST /`

The RPC endpoint for invoking UCAN cababilities. Supported abilities are defined below in [UCAN Capabilities](#ucan-capabilities)

The POST body must contain a [CAR encoded UCAN](https://github.com/web3-storage/ucanto/blob/main/Readme.md#transport).

`Content-Type: application/car` header must be present in the the request headers.

### `GET /version`

Returns version info for this api in JSON

```json
{ "name": "@web3-storage/upload-api", "did": "did:foo:bar", "version": "3.0.0", "commit": "sha1", "branch": "main" }
```

## UCAN Capabilities

Implements `store/*` and `upload/*` capabilities defined in [w3protocol]

### `store/add`

Register a CAR CID to be stored. Returns an S3 compatible signed upload URL usable for that CAR.

Source: [api/service/store/add.js](api/service/store/add.js)

### `store/list`

List the CAR CIDs for the issuer.

Source: [api/service/store/list.js](api/service/store/list.js)

### `store/remove`

Remove a CAR by CAR CID.

Source: [api/service/upoload/remove.js](api/service/store/remove.js)

### `upload/add`

Source: [api/service/upload/add.js](api/service/store/add.js)

### `upload/list`

Source: [api/service/upload/list.js](api/service/store/list.js)

### `upload/remove`

Source: [api/service/upload/remove.js](api/service/store/remove.js)

## Examples

Use the JS [upload-client] to handle the details of content-addressing your files, encoding them into a CAR, and sending it to the service with a valid UCAN.

```js
import { Agent } from '@web3-storage/access'
import { store } from '@web3-storage/capabilities/store'
import { upload } from '@web3-storage/capabilities/upload'

import { uploadFile } from '@web3-storage/upload-client'

// holds your identity on this device
const agent = await Agent.create()

// your upload... either from a <input type=file> or from a path on your fs using `files-from-path`
const file = new Blob(['Hello World!'])

// the Content-Address for your file, derived client side before sending to the service.
// Returns once your data is safely stored.
const cid = await uploadFile({
  issuer: agent.issuer,
  with: agent.currentSpace(),
  proofs: await agent.proofs([store, upload]),
}, file)
```

[SST]: https://sst.dev
[UCAN]: https://github.com/ucan-wg/spec/
[ucanto]: https://www.npmjs.com/package/ucanto
[seed.run]: https://seed.run
[w3protocol]: https://github.com/web3-storage/w3protocol
[upload-client]: https://www.npmjs.com/package/@web3-storage/upload-client
