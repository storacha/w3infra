# API Specification: POST /revocations/check

**Version:** 1.0  
**Last Updated:** 2025-08-12  

## Overview

The `/revocations/check` endpoint allows clients to check for revocations across multiple delegation CIDs in a single request. This endpoint is fully unauthenticated as revocation information is considered public data.

## Endpoint Details

- **Method:** `POST`
- **Path:** `/revocations/check`
- **Authentication:** None required (public endpoint)
- **Content-Type:** `application/json`

## Request Format

### Request Body

```json
{
  "cids": [
    "string"
  ]
}
```

### Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cids` | `string[]` | Yes | Array of delegation CID strings to check for revocations |

### Constraints

- **Minimum CIDs:** 1
- **Maximum CIDs:** 100 (DynamoDB BatchGetItem limit)
- **CID Format:** Valid IPFS CID strings

## Response Format

### Success Response (200)

```json
{
  "revocations": {
    "[delegationCID]": {
      "[scopeDID]": {
        "cause": "[causeCID]"
      }
    }
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `revocations` | `object` | Map of delegation CIDs to their revocation data |
| `[delegationCID]` | `object` | Revocation data for a specific delegation CID (only present if revoked) |
| `[scopeDID]` | `object` | Revocation scope keyed by DID |
| `cause` | `string` | CID of the revocation cause/proof |

### Example Success Response

```json
{
  "revocations": {
    "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi": {
      "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK": {
        "cause": "bafybeie5gq4jxvzmsym6hjlwxej4rwdoxt7wadqvmmwbqi7r27fclha2va"
      }
    }
  }
}
```

**Note:** If a delegation CID has no revocations, it will not appear in the response object.

## Error Responses

### 400 Bad Request

#### Invalid JSON
```json
{
  "error": "Invalid JSON",
  "message": "Request body must be valid JSON"
}
```

#### Missing CIDs Field
```json
{
  "error": "Missing required field: cids",
  "message": "Please provide delegation CIDs as an array in the \"cids\" field"
}
```

#### Invalid CIDs Type
```json
{
  "error": "Invalid field type: cids",
  "message": "The \"cids\" field must be an array of strings"
}
```

#### Empty CIDs Array
```json
{
  "error": "Invalid parameter: cids",
  "message": "At least one delegation CID must be provided"
}
```

#### Too Many CIDs
```json
{
  "error": "Too many CIDs",
  "message": "Maximum 100 delegation CIDs can be checked in a single request"
}
```

### 500 Internal Server Error

#### Query Failure
```json
{
  "error": "Internal server error",
  "message": "Failed to query revocations"
}
```

#### General Error
```json
{
  "error": "Internal server error",
  "message": "An unexpected error occurred"
}
```

## CORS Headers

The endpoint includes CORS headers for cross-origin requests:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST`
- `Access-Control-Allow-Headers: Content-Type`

## Usage Examples

### cURL Example

```bash
curl -X POST https://up.storacha.network/revocations/check \
  -H "Content-Type: application/json" \
  -d '{
    "cids": [
      "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      "bafybeie5gq4jxvzmsym6hjlwxej4rwdoxt7wadqvmmwbqi7r27fclha2va"
    ]
  }'
```

### JavaScript Example

```javascript
const response = await fetch('https://up.storacha.network/revocations/check', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    cids: [
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      'bafybeie5gq4jxvzmsym6hjlwxej4rwdoxt7wadqvmmwbqi7r27fclha2va'
    ]
  })
});

const data = await response.json();
console.log(data.revocations);
```

## Implementation Details

### Backend Storage
- Uses DynamoDB for revocation storage
- Leverages `BatchGetItem` for efficient querying of multiple CIDs
- Implements the existing `RevocationsStorage.query()` method

### Performance Characteristics
- **Batch Size:** Up to 100 CIDs per request
- **Response Time:** Typically < 100ms for small batches
- **Rate Limiting:** None currently implemented

### Security Considerations
- **No Authentication Required:** Revocation data is public information
- **Input Validation:** Comprehensive validation of request format and constraints

## Deployment Information

- **Environment Variable:** `REVOCATION_TABLE_NAME`
- **AWS Permissions:** DynamoDB read access to revocation table
- **Handler:** `upload-api/functions/revocations.handler`
- **Monitoring:** Integrated with Sentry for error tracking


