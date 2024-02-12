# HTTP-UCAN Bridge

## Summary

We have implemented a "bridge" that allows w3up users to interact with the service
without implementing the UCAN invocation wire protocols. 

A user can submit an HTTP request like (simplified for clarity):

```
POST /bridge
X-Auth-Secret: NGY2YTQ1YjYwNWFiYWU2YWNmYmY4NWFhODc4YjEwYzQ=
Authorization: Bearer eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsInVjdiI6IjAuOS4xIn0.eyJhdHQiOlt7ImNhbiI6InVwbG9hZC9saXN0Iiwid2l0aCI6ImRpZDprZXk6ejZNa3JUblpIRU1aQnYzMjRIMlV5N2N1cjZIR29weXRuZkc4V3RBbzEyTFByQjk0In1dLCJhdWQiOiJkaWQ6a2V5Ono2TWtyczNVbkRZVndVZ2FDWDl5OGdVeGY0c2VKblFxSGE5OWltQkhLa2hiekV5dSIsImV4cCI6MTcwNzUyMzIzNCwiaXNzIjoiZGlkOmtleTp6Nk1ralJ4QmkycDdHelRrTFFRSE5RNGZIY1ExWHQzaVBKVVpxRGVKMnd3UTRlVVUiLCJwcmYiOlsiYmFmeXJlaWQ2dXNwNnZncmprNjRuNXZ6ZGlkZ2gyeW9mbHA0NnRwcmZvdnFwdHozM283eTRvcmxyM3EiXX0.VH09YeLZjT28QpipB4kDRHWdnHq08GiwjlCIaxD2z8XXr5-WC2eR39scKYC8_kAxiRc5EdJ8Vj25hwld2eTyBw
Content-Type: application/json

{
  "call": "store/add",
  "on": "did:key:z6Mkm5qHN9g9NQSGbBfL7iGp9sexdssioT4CzyVap9ATqGqX",
  "inputs": {
    "link": "bafybeicxsrpxilwb6bdtq6iztjziosrqts5qq2kgali3xuwgwjjjpx5j24",
    "size": 42
  }
}
```

And receive a JSON-encoded UCAN receipt in response.

### Authorization

The `X-Auth-Secret` and `Authorization` header values can be generated with the `bridge generate-tokens` command of `w3cli`:

```sh
$ w3 bridge generate-tokens did:key:z6Mkm5qHN9g9NQSGbBfL7iGp9sexdssioT4CzyVap9ATqGqX --expiration 1707264563641

X-Auth-Secret header: NGY2YTQ1YjYwNWFiYWU2YWNmYmY4NWFhODc4YjEwYzQ=

Authorization header: Bearer eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsInVjdiI6IjAuOS4xIn0.eyJhdHQiOlt7ImNhbiI6InVwbG9hZC9saXN0Iiwid2l0aCI6ImRpZDprZXk6ejZNa3JUblpIRU1aQnYzMjRIMlV5N2N1cjZIR29weXRuZkc4V3RBbzEyTFByQjk0In1dLCJhdWQiOiJkaWQ6a2V5Ono2TWtyczNVbkRZVndVZ2FDWDl5OGdVeGY0c2VKblFxSGE5OWltQkhLa2hiekV5dSIsImV4cCI6MTcwNzUyMzIzNCwiaXNzIjoiZGlkOmtleTp6Nk1ralJ4QmkycDdHelRrTFFRSE5RNGZIY1ExWHQzaVBKVVpxRGVKMnd3UTRlVVUiLCJwcmYiOlsiYmFmeXJlaWQ2dXNwNnZncmprNjRuNXZ6ZGlkZ2gyeW9mbHA0NnRwcmZvdnFwdHozM283eTRvcmxyM3EiXX0.VH09YeLZjT28QpipB4kDRHWdnHq08GiwjlCIaxD2z8XXr5-WC2eR39scKYC8_kAxiRc5EdJ8Vj25hwld2eTyBw
```

`X-Auth-Secret` is a base64pad-encoded Uint8Array of arbitrary length that will be used to derive an ed25519 principal as follows:

```typescript

import { sha256 } from '@ucanto/core'
import { ed25519 } from '@ucanto/principal'

async function deriveSigner(secret: Uint8Array): Promise<ed25519.EdSigner> {
  const { digest } = await sha256.digest(secret)
  return ed25519.Signer.derive(digest)
}
```

`Authorization` is a JWT [Bearer token](https://datatracker.ietf.org/doc/html/rfc6750) representing a UCAN delegation as described by 
the [`ucan-http-bearer-token`](https:// github.com/ucan-wg/ucan-http-bearer-token?tab=readme-ov-file#ucan-as-bearer-token-specification-v030) specification.
It should grant the principal identified by `X-Auth-Secret` appropriate capabilities
on the resource identified in the JSON body of the HTTP request.

### Invocation Fields

`call`, `on` and `inputs` should be specified according to the capability you wish to invoke. 

`call` should be an "ability" string like `store/add` or `upload/add` and must be included in the set of abilities passed to the `--can` option of `w3 bridge generate-tokens`. By default, `--can` is set to `['upload/add', 'store/add']`.

Information about possible `inputs` for a particular ability can be found in https://github.com/web3-storage/specs/

`on` MUST match the resource passed as the first option to `w3 bridge generate-tokens`.