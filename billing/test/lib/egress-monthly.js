import { validate, encode, decode } from '../../data/egress-monthly.js'

/** @type {import('./api.js').TestSuite<import('./api.js').EgressMonthlyTestContext>} */
export const test = {
  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'validate should accept valid full record': async (assert, ctx) => {
    const input = {
      customer: 'did:mailto:example.com:user',
      space: 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob',
      month: '2024-01',
      bytes: 1000,
      eventCount: 5
    }

    const result = validate(input)
    assert.ok(!result.error, 'Should validate successfully')
    if (result.error) return

    assert.equal(result.ok.customer.toString(), input.customer)
    assert.equal(result.ok.space.toString(), input.space)
    assert.equal(result.ok.month, input.month)
    assert.equal(result.ok.bytes, input.bytes)
    assert.equal(result.ok.eventCount, input.eventCount)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'validate should reject invalid customer DID': async (assert, ctx) => {
    const input = {
      customer: 'invalid-did',
      space: 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob',
      month: '2024-01',
      bytes: 1000,
      eventCount: 5
    }

    const result = validate(input)
    assert.ok(result.error, 'Should fail validation')
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'validate should reject invalid month format': async (assert, ctx) => {
    const input = {
      customer: 'did:mailto:example.com:user',
      space: 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob',
      month: '2024-1',  // Invalid format, should be 2024-01
      bytes: 1000,
      eventCount: 5
    }

    const result = validate(input)
    assert.ok(result.error, 'Should fail validation for invalid month format')
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'validate should support partial validation with fields parameter': async (assert, ctx) => {
    const input = {
      month: '2024-01',
      customer: 'did:mailto:example.com:user'
    }

    const result = validate(input, ['month', 'customer'])
    assert.ok(!result.error, 'Should validate successfully with partial fields')
    if (result.error) return

    assert.equal(result.ok.month, input.month)
    assert.equal(result.ok.customer?.toString(), input.customer)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'validate should accept partial validation with only month': async (assert, ctx) => {
    const input = {
      month: '2024-01'
    }

    const result = validate(input, ['month'])
    assert.ok(!result.error, 'Should validate successfully with only month')
    if (result.error) return

    assert.equal(result.ok.month, input.month)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'encode should create proper DynamoDB record': async (assert, ctx) => {
    const input = {
      customer: 'did:mailto:example.com:user',
      space: 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob',
      month: '2024-01',
      bytes: 1000,
      eventCount: 5
    }

    // First validate
    const validated = validate(input)
    assert.ok(!validated.error, 'Validation should succeed')
    if (validated.error) return

    // Then encode
    const result = encode(validated.ok)
    assert.ok(!result.error, 'Encoding should succeed')
    if (result.error) return

    assert.equal(result.ok.pk, `customer#${input.customer}`)
    assert.equal(result.ok.sk, `${input.month}#${input.space}`)
    assert.equal(result.ok.space, input.space)
    assert.equal(result.ok.month, input.month)
    assert.equal(result.ok.bytes, input.bytes)
    assert.equal(result.ok.eventCount, input.eventCount)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'decode should reconstruct original data': async (assert, ctx) => {
    const storeRecord = {
      pk: 'customer#did:mailto:example.com:user',
      sk: '2024-01#did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob',
      space: 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob',
      month: '2024-01',
      bytes: 1000,
      eventCount: 5
    }

    const result = decode(storeRecord)
    assert.ok(!result.error, 'Decoding should succeed')
    if (result.error) return

    assert.equal(result.ok.customer.toString(), 'did:mailto:example.com:user')
    assert.equal(result.ok.space.toString(), 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob')
    assert.equal(result.ok.month, '2024-01')
    assert.equal(result.ok.bytes, 1000)
    assert.equal(result.ok.eventCount, 5)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'encode and decode should be reversible': async (assert, ctx) => {
    const original = {
      customer: 'did:mailto:example.com:user',
      space: 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob',
      month: '2024-01',
      bytes: 1000,
      eventCount: 5
    }

    // Validate
    const validated = validate(original)
    assert.ok(!validated.error, 'Validation should succeed')
    if (validated.error) return

    // Encode
    const encoded = encode(validated.ok)
    assert.ok(!encoded.error, 'Encoding should succeed')
    if (encoded.error) return

    // Decode
    const decoded = decode(encoded.ok)
    assert.ok(!decoded.error, 'Decoding should succeed')
    if (decoded.error) return

    // Verify round-trip
    assert.equal(decoded.ok.customer.toString(), original.customer)
    assert.equal(decoded.ok.space.toString(), original.space)
    assert.equal(decoded.ok.month, original.month)
    assert.equal(decoded.ok.bytes, original.bytes)
    assert.equal(decoded.ok.eventCount, original.eventCount)
  },

  // === Store Operations: increment() ===

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'increment should create new record for first event': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:user1'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob'
    const month = '2024-01'
    const bytes = 1000

    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month, bytes })

    // Verify record was created by listing
    const listResult = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, month)
    assert.ok(!listResult.error, 'Should list successfully')
    if (listResult.error) return

    assert.equal(listResult.ok.spaces.length, 1, 'Should have one space')
    assert.equal(listResult.ok.spaces[0].space, space)
    assert.equal(listResult.ok.spaces[0].month, month)
    assert.equal(listResult.ok.spaces[0].bytes, bytes)
    assert.equal(listResult.ok.spaces[0].eventCount, 1)
    assert.equal(listResult.ok.total, bytes)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'increment should atomically add to existing record': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:user2'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob'
    const month = '2024-01'

    // First increment
    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month, bytes: 1000 })

    // Second increment to same record
    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month, bytes: 500 })

    // Verify both increments were added
    const result = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, month)
    assert.ok(!result.error)
    if (result.error) return

    assert.equal(result.ok.spaces[0].bytes, 1500, 'Bytes should be sum of increments')
    assert.equal(result.ok.spaces[0].eventCount, 2, 'Event count should be 2')
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'increment should handle multiple increments in sequence': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:user3'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob'
    const month = '2024-02'
    const increments = [100, 200, 300, 400, 500]

    // Perform multiple increments
    for (const bytes of increments) {
      await ctx.egressTrafficMonthlyStore.increment({ customer, space, month, bytes })
    }

    const result = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, month)
    assert.ok(!result.error)
    if (result.error) return

    const expectedTotal = increments.reduce((sum, n) => sum + n, 0)
    assert.equal(result.ok.spaces[0].bytes, expectedTotal)
    assert.equal(result.ok.spaces[0].eventCount, increments.length)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'increment should create separate records for different months': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:user4'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob'

    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month: '2024-01', bytes: 1000 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month: '2024-02', bytes: 2000 })

    // Check January
    const jan = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, '2024-01')
    assert.ok(!jan.error)
    if (jan.error) return
    assert.equal(jan.ok.spaces.length, 1)
    assert.equal(jan.ok.spaces[0].bytes, 1000)

    // Check February
    const feb = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, '2024-02')
    assert.ok(!feb.error)
    if (feb.error) return
    assert.equal(feb.ok.spaces.length, 1)
    assert.equal(feb.ok.spaces[0].bytes, 2000)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'increment should create separate records for different spaces': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:user5'
    const space1 = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob'
    const space2 = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9alice'
    const month = '2024-01'

    await ctx.egressTrafficMonthlyStore.increment({ customer, space: space1, month, bytes: 1000 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space: space2, month, bytes: 2000 })

    const result = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, month)
    assert.ok(!result.error)
    if (result.error) return

    assert.equal(result.ok.spaces.length, 2, 'Should have two spaces')
    assert.equal(result.ok.total, 3000, 'Total should be sum of both spaces')
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'increment should create separate records for different customers': async (assert, ctx) => {
    const customer1 = 'did:mailto:example.com:user6'
    const customer2 = 'did:mailto:example.com:user7'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob'
    const month = '2024-01'

    await ctx.egressTrafficMonthlyStore.increment({ customer: customer1, space, month, bytes: 1000 })
    await ctx.egressTrafficMonthlyStore.increment({ customer: customer2, space, month, bytes: 2000 })

    // Check customer1
    const result1 = await ctx.egressTrafficMonthlyStore.listByCustomer(customer1, month)
    assert.ok(!result1.error)
    if (result1.error) return
    assert.equal(result1.ok.total, 1000)

    // Check customer2
    const result2 = await ctx.egressTrafficMonthlyStore.listByCustomer(customer2, month)
    assert.ok(!result2.error)
    if (result2.error) return
    assert.equal(result2.ok.total, 2000)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'increment should throw on validation error': async (assert, ctx) => {
    try {
      await ctx.egressTrafficMonthlyStore.increment({
        customer: 'invalid-did',
        space: 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob',
        month: '2024-01',
        bytes: 1000
      })
      assert.ok(false, 'Should have thrown error')
    } catch (error) {
      assert.ok(error, 'Should throw validation error')
    }
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'increment should throw on invalid month format': async (assert, ctx) => {
    try {
      await ctx.egressTrafficMonthlyStore.increment({
        customer: 'did:mailto:example.com:user',
        space: 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9bob',
        month: '2024-1', // Invalid format
        bytes: 1000
      })
      assert.ok(false, 'Should have thrown error')
    } catch (error) {
      assert.ok(error, 'Should throw validation error for invalid month')
    }
  },

  // === Store Operations: sumBySpace() ===

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'sumBySpace should return 0 for space with no egress': async (assert, ctx) => {
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9never'
    const result = await ctx.egressTrafficMonthlyStore.sumBySpace(space, {
      from: new Date('2024-01-01'),
      to: new Date('2024-02-01')
    })

    assert.ok(!result.error)
    if (result.error) return
    assert.equal(result.ok, 0)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'sumBySpace should sum bytes for single month': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:sum1'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9sum1'
    const month = '2024-03'

    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month, bytes: 5000 })

    const result = await ctx.egressTrafficMonthlyStore.sumBySpace(space, {
      from: new Date('2024-03-01'),
      to: new Date('2024-04-01')
    })

    assert.ok(!result.error)
    if (result.error) return
    assert.equal(result.ok, 5000)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'sumBySpace should sum bytes across multiple months': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:sum2'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9sum2'

    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month: '2024-01', bytes: 1000 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month: '2024-02', bytes: 2000 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month: '2024-03', bytes: 3000 })

    const result = await ctx.egressTrafficMonthlyStore.sumBySpace(space, {
      from: new Date('2024-01-01'),
      to: new Date('2024-04-01')
    })

    assert.ok(!result.error)
    if (result.error) return
    assert.equal(result.ok, 6000, 'Should sum all three months')
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'sumBySpace should return correct total when multiple increments in same month': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:sum5'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9sum5'
    const month = '2024-04'

    // Multiple increments in same month
    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month, bytes: 100 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month, bytes: 200 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month, bytes: 300 })

    const result = await ctx.egressTrafficMonthlyStore.sumBySpace(space, {
      from: new Date('2024-04-01'),
      to: new Date('2024-05-01')
    })

    assert.ok(!result.error)
    if (result.error) return
    assert.equal(result.ok, 600, 'Should sum all increments')
  },

  // === Store Operations: listByCustomer() ===

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'listByCustomer should return empty array for customer with no egress': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:nodata'
    const result = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, '2024-01')

    assert.ok(!result.error)
    if (result.error) return

    assert.equal(result.ok.spaces.length, 0)
    assert.equal(result.ok.total, 0)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'listByCustomer should return single space egress': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:list1'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9list1'
    const month = '2024-05'

    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month, bytes: 7000 })

    const result = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, month)
    assert.ok(!result.error)
    if (result.error) return

    assert.equal(result.ok.spaces.length, 1)
    assert.equal(result.ok.spaces[0].space, space)
    assert.equal(result.ok.spaces[0].month, month)
    assert.equal(result.ok.spaces[0].bytes, 7000)
    assert.equal(result.ok.total, 7000)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'listByCustomer should return multiple spaces egress': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:list2'
    const space1 = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9sp1'
    const space2 = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9sp2'
    const space3 = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9sp3'
    const month = '2024-06'

    await ctx.egressTrafficMonthlyStore.increment({ customer, space: space1, month, bytes: 1000 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space: space2, month, bytes: 2000 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space: space3, month, bytes: 3000 })

    const result = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, month)
    assert.ok(!result.error)
    if (result.error) return

    assert.equal(result.ok.spaces.length, 3, 'Should have 3 spaces')
    assert.equal(result.ok.total, 6000, 'Total should be sum of all spaces')
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'listByCustomer should calculate correct total': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:list3'
    const month = '2024-07'

    // Create spaces with different byte amounts
    await ctx.egressTrafficMonthlyStore.increment({
      customer,
      space: 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9a',
      month,
      bytes: 123
    })
    await ctx.egressTrafficMonthlyStore.increment({
      customer,
      space: 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9b',
      month,
      bytes: 456
    })
    await ctx.egressTrafficMonthlyStore.increment({
      customer,
      space: 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9c',
      month,
      bytes: 789
    })

    const result = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, month)
    assert.ok(!result.error)
    if (result.error) return

    const manualTotal = result.ok.spaces.reduce((sum, s) => sum + s.bytes, 0)
    assert.equal(result.ok.total, manualTotal, 'Total should equal sum of all space bytes')
    assert.equal(result.ok.total, 1368)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'listByCustomer should only return records for specified month': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:list4'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9list4'

    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month: '2024-01', bytes: 1000 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month: '2024-02', bytes: 2000 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month: '2024-03', bytes: 3000 })

    // Query only February
    const result = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, '2024-02')
    assert.ok(!result.error)
    if (result.error) return

    assert.equal(result.ok.spaces.length, 1)
    assert.equal(result.ok.spaces[0].month, '2024-02')
    assert.equal(result.ok.total, 2000)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'listByCustomer should include all required fields in space records': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:list5'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9list5'
    const month = '2024-08'

    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month, bytes: 5000 })

    const result = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, month)
    assert.ok(!result.error)
    if (result.error) return

    const spaceRecord = result.ok.spaces[0]
    assert.ok(spaceRecord.space, 'Should have space field')
    assert.ok(spaceRecord.month, 'Should have month field')
    assert.ok(typeof spaceRecord.bytes === 'number', 'Should have bytes field as number')
    assert.ok(typeof spaceRecord.eventCount === 'number', 'Should have eventCount field as number')
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'listByCustomer should handle month prefix matching correctly': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:list6'
    const space = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9list6'

    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month: '2024-01', bytes: 1000 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space, month: '2024-10', bytes: 2000 })

    // Query for 2024-01 should not return 2024-10
    const result = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, '2024-01')
    assert.ok(!result.error)
    if (result.error) return

    assert.equal(result.ok.spaces.length, 1, 'Should only return 2024-01 record')
    assert.equal(result.ok.spaces[0].month, '2024-01')
    assert.equal(result.ok.total, 1000)
  },

  /**
   * @param {import('entail').assert} assert
   * @param {import('./api.js').EgressMonthlyTestContext} ctx
   */
  'listByCustomer should return correct eventCount for each space': async (assert, ctx) => {
    const customer = 'did:mailto:example.com:list7'
    const space1 = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9ev1'
    const space2 = 'did:key:z6MkffDZCkCTWreg8868fG1FGFogcJj5X6PY93pPcWDn9ev2'
    const month = '2024-09'

    // Space1: 3 increments
    await ctx.egressTrafficMonthlyStore.increment({ customer, space: space1, month, bytes: 100 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space: space1, month, bytes: 200 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space: space1, month, bytes: 300 })

    // Space2: 2 increments
    await ctx.egressTrafficMonthlyStore.increment({ customer, space: space2, month, bytes: 400 })
    await ctx.egressTrafficMonthlyStore.increment({ customer, space: space2, month, bytes: 500 })

    const result = await ctx.egressTrafficMonthlyStore.listByCustomer(customer, month)
    assert.ok(!result.error)
    if (result.error) return

    const sp1 = result.ok.spaces.find(s => s.space === space1)
    const sp2 = result.ok.spaces.find(s => s.space === space2)

    assert.ok(sp1, 'Should find space1')
    assert.ok(sp2, 'Should find space2')
    if (!sp1 || !sp2) return

    assert.equal(sp1.eventCount, 3, 'Space1 should have 3 events')
    assert.equal(sp1.bytes, 600, 'Space1 should have 600 bytes')
    assert.equal(sp2.eventCount, 2, 'Space2 should have 2 events')
    assert.equal(sp2.bytes, 900, 'Space2 should have 900 bytes')
  }
}
