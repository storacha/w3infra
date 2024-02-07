# HTTP-UCAN Bridge

## Summary

We have implemented a "bridge" that allows w3up users to interact with the service
without implementing the UCAN invocation wire protocols. 

A user can submit an HTTP request like (simplified for clarity):

```
POST /bridge
Authorization: MYmI4NWUwMGFhNzNlZDlkM2Y2NDYxYWEwZjk1NDdjOWY=

{
  "ability": "store/add",
  "resource": "did:key:z6Mkm5qHN9g9NQSGbBfL7iGp9sexdssioT4CzyVap9ATqGqX",
  "inputs": {
    "link": "bafybeicxsrpxilwb6bdtq6iztjziosrqts5qq2kgali3xuwgwjjjpx5j24",
    "size": 42
  },
  "proof": "MOqJlcm9vdHOB2CpYJQABcRIg8oX3pzNhQ6omQIViTTLdoga/hH4EFdTlQDRJKzd5LQFndmVyc2lvbgGaAgFxEiCa4m5KeAneTomW0WJzcF3a6Wst3m8oLY4/Q4VZRoOsJqdhc1hE7aEDQNCsmjfCsOrj/m0iVZDjxZxwj66cf9hN5yxTkC/t/4MKqR7hsRQzDXep4O0Js9p3cgSlhAOdkbMarQx+qk0i8QNhdmUwLjkuMWNhdHSBomNjYW5hKmR3aXRoeDhkaWQ6a2V5Ono2TWttNXFITjlnOU5RU0diQmZMN2lHcDlzZXhkc3Npb1Q0Q3p5VmFwOUFUcUdxWGNhdWRYIu0Bu8P7ClUb33SVOyLOPQxUZ5Xe5crrHlKRvQO8uOgxtCpjZXhw9mNpc3NYIu0BYoScyDzOAQt1rUCkSiErSfsJrVf1kwu74l1i3GgbnlpjcHJmgMMDAXESIBulnNb9LPB9Br8qPQbpPi7OENfFXODPt9+62t/tNC9Xp2FzWETtoQNAsmFzSClooNmdbQazHFOZ7zus4WGhxq0G5QSk+RZdGo4NVUg8fuwaR4nxlnYr128AtgrE9c6Onzf+Yu10anbxA2F2ZTAuOS4xY2F0dIKiY2NhbmlzdG9yZS9hZGRkd2l0aHg4ZGlkOmtleTp6Nk1rbTVxSE45ZzlOUVNHYkJmTDdpR3A5c2V4ZHNzaW9UNEN6eVZhcDlBVHFHcViiY2Nhbmp1cGxvYWQvYWRkZHdpdGh4OGRpZDprZXk6ejZNa201cUhOOWc5TlFTR2JCZkw3aUdwOXNleGRzc2lvVDRDenlWYXA5QVRxR3FYY2F1ZFgi7QEYGA5FY50aOrnMapmJCO0DvHovsz4HtRZ9bd7PKJarL2NleHABY2lzc1gi7QG7w/sKVRvfdJU7Is49DFRnld7lyuseUpG9A7y46DG0KmNwcmaC2CpYJQABcRIgmuJuSngJ3k6JltFic3Bd2ulrLd5vKC2OP0OFWUaDrCbYKlglAAFxEiCa4m5KeAneTomW0WJzcF3a6Wst3m8oLY4/Q4VZRoOsJlkBcRIg8oX3pzNhQ6omQIViTTLdoga/hH4EFdTlQDRJKzd5LQGhanVjYW5AMC45LjHYKlglAAFxEiAbpZzW/SzwfQa/Kj0G6T4uzhDXxVzgz7ffutrf7TQvVw=="
}
```

And receive a JSON-encoded UCAN receipt in response.

### Authorization

The `Authorization` header and `proof` field's values can be generated with the `bridge generate-tokens` command of `w3cli`:

```sh
$ w3 bridge generate-tokens did:key:z6Mkm5qHN9g9NQSGbBfL7iGp9sexdssioT4CzyVap9ATqGqX --expiration 1707264563641

Authorization header: MYmI4NWUwMGFhNzNlZDlkM2Y2NDYxYWEwZjk1NDdjOWY=

Proof: MOqJlcm9vdHOB2CpYJQABcRIg8oX3pzNhQ6omQIViTTLdoga/hH4EFdTlQDRJKzd5LQFndmVyc2lvbgGaAgFxEiCa4m5KeAneTomW0WJzcF3a6Wst3m8oLY4/Q4VZRoOsJqdhc1hE7aEDQNCsmjfCsOrj/m0iVZDjxZxwj66cf9hN5yxTkC/t/4MKqR7hsRQzDXep4O0Js9p3cgSlhAOdkbMarQx+qk0i8QNhdmUwLjkuMWNhdHSBomNjYW5hKmR3aXRoeDhkaWQ6a2V5Ono2TWttNXFITjlnOU5RU0diQmZMN2lHcDlzZXhkc3Npb1Q0Q3p5VmFwOUFUcUdxWGNhdWRYIu0Bu8P7ClUb33SVOyLOPQxUZ5Xe5crrHlKRvQO8uOgxtCpjZXhw9mNpc3NYIu0BYoScyDzOAQt1rUCkSiErSfsJrVf1kwu74l1i3GgbnlpjcHJmgMMDAXESIBulnNb9LPB9Br8qPQbpPi7OENfFXODPt9+62t/tNC9Xp2FzWETtoQNAsmFzSClooNmdbQazHFOZ7zus4WGhxq0G5QSk+RZdGo4NVUg8fuwaR4nxlnYr128AtgrE9c6Onzf+Yu10anbxA2F2ZTAuOS4xY2F0dIKiY2NhbmlzdG9yZS9hZGRkd2l0aHg4ZGlkOmtleTp6Nk1rbTVxSE45ZzlOUVNHYkJmTDdpR3A5c2V4ZHNzaW9UNEN6eVZhcDlBVHFHcViiY2Nhbmp1cGxvYWQvYWRkZHdpdGh4OGRpZDprZXk6ejZNa201cUhOOWc5TlFTR2JCZkw3aUdwOXNleGRzc2lvVDRDenlWYXA5QVRxR3FYY2F1ZFgi7QEYGA5FY50aOrnMapmJCO0DvHovsz4HtRZ9bd7PKJarL2NleHABY2lzc1gi7QG7w/sKVRvfdJU7Is49DFRnld7lyuseUpG9A7y46DG0KmNwcmaC2CpYJQABcRIgmuJuSngJ3k6JltFic3Bd2ulrLd5vKC2OP0OFWUaDrCbYKlglAAFxEiCa4m5KeAneTomW0WJzcF3a6Wst3m8oLY4/Q4VZRoOsJlkBcRIg8oX3pzNhQ6omQIViTTLdoga/hH4EFdTlQDRJKzd5LQGhanVjYW5AMC45LjHYKlglAAFxEiAbpZzW/SzwfQa/Kj0G6T4uzhDXxVzgz7ffutrf7TQvVw==
```


### Invocation Fields

`ability`, `resource` and `inputs` should be specified according to the capability you wish to invoke. 

`ability` should be a string like `store/add` or `upload/add` and must be included in the set of abilities passed to the `--can` option of `w3 bridge generate-tokens`. By default, `--can` is set to `['upload/add', 'store/add']`.

Information about possible `inputs` for a particular ability can be found in https://github.com/web3-storage/specs/

`resource` MUST match the resource passed as the first option to `w3 bridge generate-tokens`.