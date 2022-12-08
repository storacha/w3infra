# S3 Presigned URLs

When a user invokes `store/add`, we create a "presigned" URL allowing them to make a PUT request directly to S3 with their upload.

The URL has authentication params in the query string, so anyone with the URL can use it to write to our bucket! 

This might sound bad, but the data used to sign the URL includes object key they can write to, the hash of the payload they can send, and the length of the payload, so if anyone has those exact bytes, they are welcome to provide them!

When S3 receives a request for that URL it verifies the signature sent in the `X-Amz-Signature` search param. When we construct that URL we add the `x-amz-checksum-sha256` and the `content-length` headers to the `X-Amz-SignedHeaders` param and the values for those headers are included in the signature, and must be present in the request headers for the request to be accepted. If they are missing or changed, the request will fail early with a `SignatureInvalid` error. The HTTP verb (`PUT`) and the URI with the desired object key are also part of the signature.

This means:

- It can only PUT to the object key `/${carCID}/${carCID}.car` and the user cannot change it.
- The `x-amz-checksum-sha256` header is part of the signature; we assert the hash of the CAR we expect and the user must provide this header and the expected value when making the request.
  - if they send a different checksum or omit the header the PUT will be rejected early due to the request not matching the URL signature.
  - if they send the expected checksum header but different payload bytes the upload will be rejected once it is received, when the payload checksum is verified.
- the `content-length` header is also included; the user has to tell us the size in bytes of the CAR they will send.
  - if they make a request with a different `content-length` header it will be rejected early due to the request not matching the URL signature.
  - (TBC) if they send the expected `content-length` header but the payload is larger aws will truncate the upload after the number of bytes asserted in the `content-length` header. For the upload to succeed, this truncated blob would also need to match the checksum given. In the unlikely event that the checksum and the content-length both match then the upload would be accepted, as, well, the chunk we have is exactly, byte-for-byte, what they promised to send us. Wild! More likely, this truncated upload would fail to match the checksum.
  - (TBC) if they send the expected `content-length` header but the payload is fewer bytes... (don't know, I would imagine an http error). This is a less concerning case as it means a user is asking to reserve more space than they use. Regardless we should make sure it is not possible.

## Hoisting

When presigning a URL for S3, the headers relating to auth and signing are "hoisted" to the URLSearchParams; they appear in the query so you can hand the URL off, and the params needed verify it are baked in. S3 support unpacking those params from either the query _or_ from HTTP request headers. The query params are part of the signature, so they can't be tampered with. 

You can also "hoist" and sign any other params you want... it is tempting to move `x-amz-checksum-sha256` to the query so a user wouldn't need to provide it separately. However it appears that aws does not support pulling that value out of the query, only from a request header. This is why we return the `x-amz-checksum-sha256` and `content-length` headers from `store/add` as the user MUST send them with the request, or the signature verification will fail.

## References

S3 presigned query param auth: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
