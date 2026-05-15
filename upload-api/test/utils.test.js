import anyTest from 'ava'
// NOTE: T7 — these tests target `parseWritesDisabled`, which does not yet
// exist in ../utils.js. The import below will fail at module-load time until
// the implementation is added — that is the desired RED state.
//
// We use a wildcard import so the symbol's exact module home (utils.js vs
// config.js) is a single edit away, but the brief explicitly directs T7 to
// add the export to utils.js (or config.js if that is the conventional home
// for env-var helpers — config.js currently parses DID strings, not env
// flags, so utils.js is the better fit).
import * as utils from '../utils.js'

const test = anyTest

test('parseWritesDisabled is exported as a function', (t) => {
  t.is(typeof utils.parseWritesDisabled, 'function')
})

test('parseWritesDisabled returns true when WRITES_DISABLED is the literal string "true"', (t) => {
  t.is(utils.parseWritesDisabled({ WRITES_DISABLED: 'true' }), true)
})

test('parseWritesDisabled returns false when WRITES_DISABLED is "false"', (t) => {
  t.is(utils.parseWritesDisabled({ WRITES_DISABLED: 'false' }), false)
})

test('parseWritesDisabled returns false when WRITES_DISABLED is "1" (strict match)', (t) => {
  t.is(utils.parseWritesDisabled({ WRITES_DISABLED: '1' }), false)
})

test('parseWritesDisabled returns false when WRITES_DISABLED is missing', (t) => {
  t.is(utils.parseWritesDisabled({}), false)
})

test('parseWritesDisabled returns false when WRITES_DISABLED is empty string', (t) => {
  t.is(utils.parseWritesDisabled({ WRITES_DISABLED: '' }), false)
})
