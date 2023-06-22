# Roundabout

> Roundabout allows the creation of short lived presigned URLs for content stored in web3.storage buckets (in R2). It can also get the HTTP request redirected to the given presigned URL.

## HTTP API

The given API is currently public.

### `GET /{carCid}`

Redirects to a presigned URL where the requested CAR file (by its CID) can be downloaded from. This will use web3.storage `carpark` as the location of the requested CARs. The request will return a `302 Redirect` to a created presigned URL.

It also supports a query parameter `expires` with the number of seconds this presigned URL should be valid for. You can set a value from one second to 7 days (604,800 seconds). By default the expiration is set for 3 days (259,200 seconds).

### `GET /key/{key}?bucket=bucket-name`

Redirects to a presigned URL where the requested bucket value can be downloaded from by its key. Unlike `GET /{carCid}`, this endpoint takes a key and is compatible with any web3.storage account bucket. The request will return a `302 Redirect` to a created presigned URL.

It also supports a query parameter `expires` with the number of seconds this presigned URL should be valid for. You can set a value from one second to 7 days (604,800 seconds). By default the expiration is set for 3 days (259,200 seconds).

## Usage

### Download CAR file via CURL

```console
curl -L -v https://roundabout.web3.storage/bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua --output bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua.car
```

### Get presigned URL for CAR file via CURL

For some use cases, just getting a presigned URL to use later might be needed. Therefore, it is also possible to rely on a HEAD request to get the presigned URL present in the `location` header of the response.

```console
curl --head https://roundabout.web3.storage/bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua

HTTP/2 302
date: Wed, 21 Jun 2023 10:12:15 GMT
content-length: 0
location: https://carpark-prod-0.fffa4b4363a7e5250af8357087263b3a.r2.cloudflarestorage.com/bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua/bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua.car?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=a314d2872c5c092e911e3e2c7b5e5c3f%2F20230621%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20230621T101215Z&X-Amz-Expires=259200&X-Amz-Signature=f61b984f0dad126f0f8e151cbb2eb0b9e10adb68b4ead7a0263a044a5b1985a9&X-Amz-SignedHeaders=host&x-id=GetObject
apigw-requestid: G3T3xg1LvHcEPxA=
```

### Get presigned URL for CAR file with custom expiration via CURL

```console
curl --head https://roundabout.web3.storage/bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua?expires=900

HTTP/2 302
date: Wed, 21 Jun 2023 10:12:15 GMT
content-length: 0
location: https://carpark-prod-0.fffa4b4363a7e5250af8357087263b3a.r2.cloudflarestorage.com/bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua/bagbaiera222226db4v4oli5fldqghzgbv5rqv3n4ykyfxk7shfr42bfnqwua.car?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=a314d2872c5c092e911e3e2c7b5e5c3f%2F20230621%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20230621T101215Z&X-Amz-Expires=900&X-Amz-Signature=f61b984f0dad126f0f8e151cbb2eb0b9e10adb68b4ead7a0263a044a5b1985a9&X-Amz-SignedHeaders=host&x-id=GetObject
apigw-requestid: G3T3xg1LvHcEPxA=
```

### Get presigned URL for file with key and custom bucket via CURL

```console
curl -L https://roundabout.web3.storage/key/0000c19bd9cd7fa9c532eba81428eda0_baga6ea4seaqpohse35l4xucs5mtabgewpp4mgtle7yym7em6ouvhgjb7wc2pcmq.car?bucket\=dagcargo
```
