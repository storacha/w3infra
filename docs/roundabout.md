# Roundabout

> Roundabout allows the creation of short lived presigned URLs for content stored in carpark bucket (in R2). It can also get the HTTP request redirected to the given presigned URL.

## HTTP API

The given API is currently public.

### `GET /{carCid}`

Redirects to a URL where the requested CAR file (by its CID) can be downloaded from. The request will return a `302 Redirect` to a created signed URL.

```console
curl -L -v https://roundabout.web3.storage/presigned-url/bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua --output bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua.car
```

### `GET /presigned-url/{carCid}`

Gets a presigned URL to get the content of a CAR file (by its CID). This presigned URL is valid by 3 days by default. This also supports a query parameter `expires` with the number of seconds this presigned URL should be valid for.

```console
curl -v https://roundabout.web3.storage/bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua

https://carpark-prod-0.fffa4b4363a7e5250af8357087263b3a.r2.cloudflarestorage.com/bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua/bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua.car?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=a314d2872c5c092e911e3e2c7b5e5c3f%2F20230614%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20230614T134031Z&X-Amz-Expires=259200&X-Amz-Signature=8ec453f58c87d095d63b055fe5e26db37153a4033443b358b18f0ab657f3adab&X-Amz-SignedHeaders=host&x-id=GetObject%
```
