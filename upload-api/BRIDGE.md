# HTTP-UCAN Bridge

## Summary

We have implemented a "bridge" that allows w3up users to interact with the service
without implementing the UCAN invocation wire protocols. 

A user can submit an HTTP request like (simplified for clarity):

```
POST /bridge
X-Auth-Secret: uNGUyOTA2OTRlYjNlZDJjNjE3ZTRkNzBlYzJiN2RkYTM
Authorization: uOqJlcm9vdHOB2CpYJQABcRIggNKF1CtKV9n5k1T8575Uh8T5P-Ju8u9J4PMymVnXrC5ndmVyc2lvbgG-BQFxEiB-pJ_qmilXuN7XI0DMfWHFW_npviV1YPnne3fxx0Vx3Khhc1hE7aEDQKF3NP3YRysG_gzE7uF4T_-HFcSMWMDr2rOgCdGpnKtqP9hEuuMfjpz_1-rCHTkiIQnpELGw6wO5rWUuOfM8pgRhdmUwLjkuMWNhdHSGomNjYW5nc3BhY2UvKmR3aXRoeDhkaWQ6a2V5Ono2TWtyVG5aSEVNWkJ2MzI0SDJVeTdjdXI2SEdvcHl0bmZHOFd0QW8xMkxQckI5NKJjY2FuZ3N0b3JlLypkd2l0aHg4ZGlkOmtleTp6Nk1rclRuWkhFTVpCdjMyNEgyVXk3Y3VyNkhHb3B5dG5mRzhXdEFvMTJMUHJCOTSiY2Nhbmh1cGxvYWQvKmR3aXRoeDhkaWQ6a2V5Ono2TWtyVG5aSEVNWkJ2MzI0SDJVeTdjdXI2SEdvcHl0bmZHOFd0QW8xMkxQckI5NKJjY2FuaGFjY2Vzcy8qZHdpdGh4OGRpZDprZXk6ejZNa3JUblpIRU1aQnYzMjRIMlV5N2N1cjZIR29weXRuZkc4V3RBbzEyTFByQjk0omNjYW5qZmlsZWNvaW4vKmR3aXRoeDhkaWQ6a2V5Ono2TWtyVG5aSEVNWkJ2MzI0SDJVeTdjdXI2SEdvcHl0bmZHOFd0QW8xMkxQckI5NKJjY2FuZ3VzYWdlLypkd2l0aHg4ZGlkOmtleTp6Nk1rclRuWkhFTVpCdjMyNEgyVXk3Y3VyNkhHb3B5dG5mRzhXdEFvMTJMUHJCOTRjYXVkWCLtAUn0qM5JR33gEL3vJ0-FYRaYfKOWfY82JUvkwOHZahYVY2V4cBpnpqjmY2ZjdIGhZXNwYWNloWRuYW1lZnRyYXZpc2Npc3NYIu0Bsm6-NkeTTvIb1q1lweVyY_gHAXbO5r3JrlIrw6nlo2NjcHJmgNECAXESILbAasj0dgIrbhevRQieJFyjmwmxQ2ekaL9QG8Y2i7Gcp2FzWETtoQNAX5yt8ege1TlDd7_ETGviAPBStxgLnq1WaAqgoIRw4lJUk6ha88Wg23VBuNY-IQ380_ZaxxYnTuXf72OZsxEDDWF2ZTAuOS4xY2F0dIGiY2Nhbmt1cGxvYWQvbGlzdGR3aXRoeDhkaWQ6a2V5Ono2TWtyVG5aSEVNWkJ2MzI0SDJVeTdjdXI2SEdvcHl0bmZHOFd0QW8xMkxQckI5NGNhdWRYIu0BEtkc3siSUH7S0eTOj30FFnw7sSiNzFgxY4lOrUaGKbBjZXhwGmXO8PpjaXNzWCLtAUn0qM5JR33gEL3vJ0-FYRaYfKOWfY82JUvkwOHZahYVY3ByZoHYKlglAAFxEiB-pJ_qmilXuN7XI0DMfWHFW_npviV1YPnne3fxx0Vx3FkBcRIggNKF1CtKV9n5k1T8575Uh8T5P-Ju8u9J4PMymVnXrC6hanVjYW5AMC45LjHYKlglAAFxEiC2wGrI9HYCK24Xr0UIniRco5sJsUNnpGi_UBvGNouxnA
Content-Type: application/json
{
  tasks: [
    {
      "do": "store/add",
      "sub": "did:key:z6Mkm5qHN9g9NQSGbBfL7iGp9sexdssioT4CzyVap9ATqGqX",
      "args": {
        "link": "bagbaierah5sr5zt3tqgkrixptqzyerpxp5vwyjlx3n5frp2tbnr3clqrmrqa",
        "size": 42
      },
    },
    {
      "do": "store/add",
      "sub": "did:key:z6Mkm5qHN9g9NQSGbBfL7iGp9sexdssioT4CzyVap9ATqGqX",
      "args": {
        "link": "bafybeicajpuoxboivzka7cyft7okjf6vp43uk5udnedsrle6jews2cqj3a",
        "size": 789
      }
    }
  ]
}
```

TODO: support alternate content types, (specifically dag-cbor?)

And receive a dag-json-encoded list of UCAN receipt results [q: should this be the full receipt?] in response.

### Authorization

The `X-Auth-Secret` and `Authorization` header values can be generated with the `bridge generate-tokens` command of `w3cli`:

```sh
$ w3 bridge generate-tokens did:key:z6Mkm5qHN9g9NQSGbBfL7iGp9sexdssioT4CzyVap9ATqGqX --expiration 1707264563641

X-Auth-Secret header: uNGUyOTA2OTRlYjNlZDJjNjE3ZTRkNzBlYzJiN2RkYTM=

Authorization header: uOqJlcm9vdHOB2CpYJQABcRIggNKF1CtKV9n5k1T8575Uh8T5P-Ju8u9J4PMymVnXrC5ndmVyc2lvbgG-BQFxEiB-pJ_qmilXuN7XI0DMfWHFW_npviV1YPnne3fxx0Vx3Khhc1hE7aEDQKF3NP3YRysG_gzE7uF4T_-HFcSMWMDr2rOgCdGpnKtqP9hEuuMfjpz_1-rCHTkiIQnpELGw6wO5rWUuOfM8pgRhdmUwLjkuMWNhdHSGomNjYW5nc3BhY2UvKmR3aXRoeDhkaWQ6a2V5Ono2TWtyVG5aSEVNWkJ2MzI0SDJVeTdjdXI2SEdvcHl0bmZHOFd0QW8xMkxQckI5NKJjY2FuZ3N0b3JlLypkd2l0aHg4ZGlkOmtleTp6Nk1rclRuWkhFTVpCdjMyNEgyVXk3Y3VyNkhHb3B5dG5mRzhXdEFvMTJMUHJCOTSiY2Nhbmh1cGxvYWQvKmR3aXRoeDhkaWQ6a2V5Ono2TWtyVG5aSEVNWkJ2MzI0SDJVeTdjdXI2SEdvcHl0bmZHOFd0QW8xMkxQckI5NKJjY2FuaGFjY2Vzcy8qZHdpdGh4OGRpZDprZXk6ejZNa3JUblpIRU1aQnYzMjRIMlV5N2N1cjZIR29weXRuZkc4V3RBbzEyTFByQjk0omNjYW5qZmlsZWNvaW4vKmR3aXRoeDhkaWQ6a2V5Ono2TWtyVG5aSEVNWkJ2MzI0SDJVeTdjdXI2SEdvcHl0bmZHOFd0QW8xMkxQckI5NKJjY2FuZ3VzYWdlLypkd2l0aHg4ZGlkOmtleTp6Nk1rclRuWkhFTVpCdjMyNEgyVXk3Y3VyNkhHb3B5dG5mRzhXdEFvMTJMUHJCOTRjYXVkWCLtAUn0qM5JR33gEL3vJ0-FYRaYfKOWfY82JUvkwOHZahYVY2V4cBpnpqjmY2ZjdIGhZXNwYWNloWRuYW1lZnRyYXZpc2Npc3NYIu0Bsm6-NkeTTvIb1q1lweVyY_gHAXbO5r3JrlIrw6nlo2NjcHJmgNECAXESILbAasj0dgIrbhevRQieJFyjmwmxQ2ekaL9QG8Y2i7Gcp2FzWETtoQNAX5yt8ege1TlDd7_ETGviAPBStxgLnq1WaAqgoIRw4lJUk6ha88Wg23VBuNY-IQ380_ZaxxYnTuXf72OZsxEDDWF2ZTAuOS4xY2F0dIGiY2Nhbmt1cGxvYWQvbGlzdGR3aXRoeDhkaWQ6a2V5Ono2TWtyVG5aSEVNWkJ2MzI0SDJVeTdjdXI2SEdvcHl0bmZHOFd0QW8xMkxQckI5NGNhdWRYIu0BEtkc3siSUH7S0eTOj30FFnw7sSiNzFgxY4lOrUaGKbBjZXhwGmXO8PpjaXNzWCLtAUn0qM5JR33gEL3vJ0-FYRaYfKOWfY82JUvkwOHZahYVY3ByZoHYKlglAAFxEiB-pJ_qmilXuN7XI0DMfWHFW_npviV1YPnne3fxx0Vx3FkBcRIggNKF1CtKV9n5k1T8575Uh8T5P-Ju8u9J4PMymVnXrC6hanVjYW5AMC45LjHYKlglAAFxEiC2wGrI9HYCK24Xr0UIniRco5sJsUNnpGi_UBvGNouxnA
```

`X-Auth-Secret` is a base64url-multibase-encoded Uint8Array of arbitrary length that will be used to derive an ed25519 principal as follows:

```typescript
import { sha256 } from '@ucanto/core'
import { ed25519 } from '@ucanto/principal'

async function deriveSigner(secret: Uint8Array): Promise<ed25519.EdSigner> {
  const { digest } = await sha256.digest(secret)
  return ed25519.Signer.derive(digest)
}
```

`Authorization` is an IPLD CAR [ed: unixfs encoded? need to understand Delegation archive format better] representing a UCAN delegation.
It should grant the principal identified by `X-Auth-Secret` appropriate capabilities
on the resource identified in the JSON body of the HTTP request.

### Invocation Fields

`do`, `sub` and `args` should be specified according to the capability you wish to invoke. 

`do` should be an "ability" string like `store/add` or `upload/add` and must be included in the set of abilities passed to the `--can` option of `w3 bridge generate-tokens`. By default, `--can` is set to `['upload/add', 'store/add']`.

Information about possible `inputs` for a particular ability can be found in https://github.com/web3-storage/specs/

`sub` MUST match the resource passed as the first option to `w3 bridge generate-tokens`.