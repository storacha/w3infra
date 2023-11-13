/**
 * This is a helper to allow rapid local development of the validation email.
 * It requires `upload-api/html.jsx` to be compiled to regular JS.
 * 
 * Usage:
 *   cd upload-api
 *   npm run build:html
 *   node test/helpers/validate-email-server.js
 */
import http from 'node:http'
import { render } from 'preact-render-to-string'
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
// @ts-ignore exists only after your run `npm run build:html`
import { ValidateEmail, buildDocument } from '../../dist/html.js'

dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) })

http.createServer((req, res) => {
  const vnode = /** @type {any} */ (ValidateEmail({
    ucan: 'test',
    email: 'test@example.org',
    audience: 'did:key:z6MkgcDgNxFxtgCfsnzZ8b4Wf5SLCskwwK18EVovcFvJugbK',
    stripePricingTableId: process.env.STRIPE_PRICING_TABLE_ID,
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY
  }))
  res.write(buildDocument(render(vnode)))
  res.end()
}).listen(9000)

console.log('http://127.0.0.1:9000')
