import { test } from '../helpers/context.js'

import { parseKinesisEvent } from '../../utils/parse-kinesis-event.js'

test('parses a kinesis event with ucan invocation', t => {
  const event = {
    Records: [
      {
        kinesis: {
          data: 'eyJjYXJDaWQiOiJiYWZ5cmVpZGVkdWc0c2RlN2xsa2NoYnBoZjduaHZvN21vbGhkY3F2a25ma2FkN2p4am1rcXMzbTJicSIsInZhbHVlIjp7ImF0dCI6W3sibmIiOnsibGluayI6eyIvIjoiYmFnYmFpZXJhMmt0eGIzcmtmeG91amJwM2gzZmhxMnJmNGRxc2ZhMmFoZ3l2ejJzdXRoY3VkN2szdWZucSJ9LCJzaXplIjoyMjV9LCJjYW4iOiJzdG9yZS9hZGQiLCJ3aXRoIjoiZGlkOmtleTp6Nk1rdmF4VTlZV3BpUHFrM3c0eGIxVndzYjNDM0VLbkNXRFpMenZWSkZtcURxYlgifV0sImF1ZCI6ImRpZDp3ZWI6c3RhZ2luZy53ZWIzLnN0b3JhZ2UiLCJpc3MiOiJkaWQ6a2V5Ono2TWtrajNzRDZCWEJjYmZSR1prbWJrVVhnV21NOFJjaTN1M2FQRlpLelpSRjNtUSIsInByZiI6W3siLyI6ImJhZnlyZWlmeG5iM3JtdGdwNnZ0dXhmNWVmaHYzb3Z3NXg3dHhjdHU2enFxcXduZ3h3d2R5MjR3YzNpIn0seyIvIjoiYmFmeXJlaWZ4bmIzcm10Z3A2dnR1eGY1ZWZodjNvdnc1eDd0eGN0dTZ6cXFxd25neHd3ZHkyNHdjM2kifV19LCJ0cyI6MTY3MTcwNTgzMzUyMX0='
        }
      },
      {
        kinesis: {
          data: 'eyJjYXJDaWQiOiJiYWZ5cmVpZ3RmbGY0amF0aWRvbTZrcW16bHZ2bGI1cWNxbm81aXhmdmluaHpzZjZrNHQzYWo0ZzJpcSIsInZhbHVlIjp7ImF0dCI6W3sibmIiOnsicm9vdCI6eyIvIjoiYmFma3JlaWRxemRweTdvNnZob3RvYWs3ZHJ4ZXRiYWRpZHJlaWlvNnZ0ZGhnaGl1eHNjYXRqNmttc2UifSwic2hhcmRzIjpbeyIvIjoiYmFnYmFpZXJhMmt0eGIzcmtmeG91amJwM2gzZmhxMnJmNGRxc2ZhMmFoZ3l2ejJzdXRoY3VkN2szdWZucSJ9XX0sImNhbiI6InVwbG9hZC9hZGQiLCJ3aXRoIjoiZGlkOmtleTp6Nk1rdmF4VTlZV3BpUHFrM3c0eGIxVndzYjNDM0VLbkNXRFpMenZWSkZtcURxYlgifV0sImF1ZCI6ImRpZDp3ZWI6c3RhZ2luZy53ZWIzLnN0b3JhZ2UiLCJpc3MiOiJkaWQ6a2V5Ono2TWtrajNzRDZCWEJjYmZSR1prbWJrVVhnV21NOFJjaTN1M2FQRlpLelpSRjNtUSIsInByZiI6W3siLyI6ImJhZnlyZWlmeG5iM3JtdGdwNnZ0dXhmNWVmaHYzb3Z3NXg3dHhjdHU2enFxcXduZ3h3d2R5MjR3YzNpIn0seyIvIjoiYmFmeXJlaWZ4bmIzcm10Z3A2dnR1eGY1ZWZodjNvdnc1eDd0eGN0dTZ6cXFxd25neHd3ZHkyNHdjM2kifV19LCJ0cyI6MTY3MTcwNTgzNTU4NH0='
        }
      }
    ]
  }

  // @ts-expect-error incomplete type for kinesis event
  const ucanInvocations = parseKinesisEvent(event)
  t.is(ucanInvocations.length, 2)

  for (const ucanInvocation of ucanInvocations) {
    t.truthy(ucanInvocation.carCid)
    t.truthy(ucanInvocation.value)
    t.truthy(ucanInvocation.ts)
  }
})
