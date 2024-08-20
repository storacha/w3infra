/**
 * This is a helper to allow rapid local development of the validation email.
 * It requires `upload-api/html.jsx` to be compiled to regular JS.
 *
 * Usage:
 *   cd upload-api
 *   npm run dev:html
 */
import express from 'express'
import reload from 'reload'
import http from 'node:http'
import { render } from 'preact-render-to-string'
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

// @ts-ignore exists only after your run `npm run build:html`
import * as htmlStoracha from '../../dist/html-storacha/index.js'
// @ts-ignore exists only after your run `npm run build:html`
import * as htmlW3s from '../../dist/html-w3s/index.js'

dotenv.config({
  path: fileURLToPath(new URL('../../../.env.local', import.meta.url)),
})

const HTMLS = { Storacha: htmlStoracha, 'web3.storage': htmlW3s }

const COMPONENTS = /** @type { const } */ ([
  'ValidateEmail',
  'PendingValidateEmail',
  'ValidateEmailError',
])

/**
 * Insert reload script into HTML
 * @param {string} html
 */
const insertReloadScript = (html) => {
  return html.replace(
    /<\/body>/,
    '<script src="/reload/reload.js"></script></body>'
  )
}

var app = express()
app.set('port', process.env.PORT || 9000)

const indexPage = /* html */ `
  <!doctype html>
  <html>
    <body>
      ${Object.entries(HTMLS)
        .map(
          ([htmlName, _html]) => /* html */ `
            <h1>${htmlName}:</h1>
            <ul>
              ${COMPONENTS.map(
                (componentName) =>
                  /* html */ `<li><a href="/${htmlName}/${componentName}">${componentName}</a></li>`
              ).join('')}
            </ul>
          `
        )
        .join('')}
    </body>
  </html>
`
app.get('/', function (req, res) {
  res.write(insertReloadScript(indexPage))
  res.end()
})

/**
 * Generate a random string
 * @param {number} n
 */
const randomString = (n) =>
  [...Array(n)].map(() => Math.random().toString(36)[2]).join('')

Object.entries(HTMLS).forEach(([htmlName, html]) => {
  COMPONENTS.forEach((componentName) => {
    app.get(`/${htmlName}/${componentName}`, function (req, res) {
      const vnode = html[componentName]({
        ucan: randomString(1000),
        email: 'test@example.org',
        audience: `did:key:${randomString(400)}`,
        stripePricingTableId: process.env.STRIPE_PRICING_TABLE_ID,
        stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
        msg: 'Missing delegation in the URL, or some such problem.',
        autoApprove: false,
        qrcode: '<div>QR code goes here</div>',
      })
      res.write(
        html
          .buildDocument(render(vnode))
          .replace(
            /<\/body>/,
            '<script src="/reload/reload.js"></script></body>'
          )
      )
      res.end()
    })
  })
})

var server = http.createServer(app)

reload(app)
  .then(function (reloadReturned) {
    // reloadReturned is documented in the returns API in the README

    // Reload started, start web server
    server.listen(app.get('port'), function () {
      console.log(
        `Dev server listening at: http://localhost:${app.get('port')}/`
      )
    })
  })
  .catch(function (err) {
    console.error(
      'Reload could not start, could not start server/sample app',
      err
    )
  })
