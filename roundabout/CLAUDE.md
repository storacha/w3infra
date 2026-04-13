# Roundabout Module

This file provides guidance for AI agents working with the `roundabout` package.

---

## Overview

Roundabout is a **content redirection service** — an HTTP gateway that resolves CIDs (Content Identifiers) to time-limited signed URLs pointing to the actual stored content.

Given a CID, it:
1. Determines what type of CID it is (CAR, RAW blob, or Piece CID)
2. Queries the Indexing Service for location claims (for RAW/Piece CIDs)
3. Generates a presigned R2/S3 URL for the content
4. Returns an HTTP 302 redirect to that signed URL

It is also used by the Filecoin pipeline (`filecoin-stack.js`) as the `CONTENT_STORE_HTTP_ENDPOINT` — the URL clients use to fetch stored content.

---

## File Structure

```
roundabout/
├── index.js              # Core factories: getSigner(), contentLocationResolver()
├── piece.js              # Piece CID detection and equivalence resolution
├── utils.js              # Query string parsing, env loading, CID type checks
├── constants.js          # CID codec/multihash codes, CARPARK_DOMAIN
├── functions/
│   └── redirect.js       # Lambda handlers: redirectGet(), redirectKeyGet()
└── test/
    ├── index.test.js     # Integration tests for signer and content resolution
    ├── piece.test.js     # Unit tests for Piece CID functions
    └── helpers/
        ├── context.js    # AVA test context definition (s3Client)
        └── resources.js  # MinIO S3 container setup, bucket creation
```

---

## HTTP API

Two Lambda handlers are exposed via API Gateway:

| Method | Route | Handler | Description |
|--------|-------|---------|-------------|
| `GET/HEAD` | `/{cid}` | `redirect.handler` | Resolve CID → presigned URL redirect |
| `GET/HEAD` | `/key/{key}` | `redirect.keyHandler` | Direct bucket key → presigned URL redirect |

### `GET /{cid}` — CID Resolution Flow

1. Parse CID from path
2. Parse `expires` query param (1s–7 days, default 3 days)
3. Determine CID type:
   - **Piece V2** → query Indexing Service for equivalent CIDs (e.g., CAR CID), then resolve content
   - **Piece V1** → return 415 Unsupported
   - **CAR / RAW** → resolve directly via `contentLocationResolver()`
4. Return 302 redirect to presigned URL, or 404 if not found

### `GET /key/{key}` — Direct Key Access

Skips CID resolution. Validates bucket name (whitelist: `['dagcargo']`) and returns a presigned URL for the raw bucket key.

---

## Core Functions

### `index.js`

**`getSigner(s3Client, bucketName)`**
- Returns a `{ getUrl(key, options) }` object
- Generates presigned `GetObject` URLs via AWS SDK S3 presigner

**`contentLocationResolver({ s3Client, bucket, expiresIn, indexingService })`**
- Returns an async `locateContent(cid)` function
- For **CAR CIDs**: signs `{cid}/{cid}.car` in the bucket
- For **RAW CIDs**: queries Indexing Service for `assert/location` claims; if URL matches carpark domain, signs it; otherwise returns the raw location URL

### `piece.js`

**`asPieceCidV2(cid)`** / **`asPieceCidV1(cid)`**
- Detects Piece CID versions by inspecting codec and multihash codes
- Returns the typed CID or `undefined`

**`findEquivalentCids(piece, indexingService?)`**
- Queries Indexing Service for `assert/equals` claims for the given Piece CID
- Returns a `Set` of equivalent CIDs (e.g., the corresponding CAR CID)
- Used by `redirectGet()` to resolve Piece V2 → CAR → signed URL

**`createIndexingServiceClient(env?)`**
- Instantiates the Indexing Service client
- Defaults to production; uses staging for non-prod SST stages

### `utils.js`

**`parseQueryStringParameters(queryParams)`**
- Validates `expires` (1–604800 seconds, default: 259200 = 3 days)
- Validates `bucket` (whitelist: `['dagcargo']`)

**`getEnv()`**
- Validates and returns required env vars: `BUCKET_ENDPOINT`, `BUCKET_REGION`, `BUCKET_NAME`, `BUCKET_ACCESS_KEY_ID`, `BUCKET_SECRET_ACCESS_KEY`

### `constants.js`

| Constant | Value | Purpose |
|----------|-------|---------|
| `RAW_CODE` | `0x55` | Raw codec multicode |
| `CAR_CODE` | `0x0202` | CAR codec code |
| `PIECE_V1_CODE` | `0xf101` | Piece V1 codec |
| `PIECE_V1_MULTIHASH` | `0x1012` | Piece V1 multihash |
| `PIECE_V2_MULTIHASH` | `0x1011` | Piece V2 multihash |
| `CARPARK_DOMAIN` | dynamic | R2 carpark public domain (e.g., `carpark-prod-0.r2.w3s.link`) |

---

## External Dependencies

| Service | Package | Usage |
|---------|---------|-------|
| R2 / S3 | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | Presign `GetObject` URLs for stored content |
| Indexing Service | `@storacha/indexing-service-client` | Query `assert/location` and `assert/equals` claims |
| Sentry | `@sentry/serverless` | Lambda error tracking |

---

## Environment Variables

Set via SST and passed to Lambda at deploy time (see `stacks/roundabout-stack.js`):

| Variable | Description |
|----------|-------------|
| `BUCKET_ENDPOINT` | R2 API endpoint |
| `BUCKET_REGION` | e.g., `us-west-2` or `auto` |
| `BUCKET_NAME` | e.g., `dagcargo` |
| `BUCKET_ACCESS_KEY_ID` | R2 credentials |
| `BUCKET_SECRET_ACCESS_KEY` | R2 credentials |
| `ROUNDABOUT_INDEXING_SERVICE_URLS` | JSON array of Indexing Service URLs (supports multiple for combining) |

Optional:
- `ROUNDABOUT_API_URL` — use a pre-deployed API instead of creating a new one
- `ROUNDABOUT_HOSTED_ZONE` — custom domain setup

---

## Deployment

Defined in `stacks/roundabout-stack.js`. Deployed as an SST API Gateway HTTP API backed by two Lambda functions (`handler`, `keyHandler`). Exports `roundaboutApiUrl` consumed by `filecoin-stack.js` as `CONTENT_STORE_HTTP_ENDPOINT`.

---

## Testing

Framework: **AVA** with **MinIO** (via testcontainers) for local S3 emulation.

```bash
# Requires Docker Desktop running
export AWS_REGION='us-west-2' AWS_ACCESS_KEY_ID='NOSUCH' AWS_SECRET_ACCESS_KEY='NOSUCH'
pnpm test -w roundabout
```

- `index.test.js` — integration tests: spins up MinIO, puts objects, validates presigned URLs end-to-end
- `piece.test.js` — unit tests: CID type detection, claim equivalence resolution with mocked client

### Test Helpers

- `test/helpers/resources.js` — `createS3()` starts MinIO container, `createBucket()` creates a random bucket
- `test/helpers/context.js` — typed AVA context with `s3Client`

---

## Key Design Patterns

- **Factory functions**: `getSigner()` and `contentLocationResolver()` return closures; pass config once, call many times.
- **CID type discrimination**: codec + multihash codes identify CAR vs RAW vs Piece CIDs — do not use string-based checks.
- **Claim-based resolution**: RAW and Piece CIDs rely entirely on Indexing Service claims for location; there is no internal registry.
- **Presigned URLs only**: content bytes are never proxied through roundabout — clients always follow the redirect to R2 directly.
- **Multi-client combining**: `ROUNDABOUT_INDEXING_SERVICE_URLS` supports multiple URLs; the Lambda combines them for redundancy.
