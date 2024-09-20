// @jsxImportSource preact
import { render } from 'preact-render-to-string'
import { Response } from '@web-std/fetch'
import storachaLogoSvg from './storacha-logo.svg'

/**
 * Dev changes quickly without deploying to AWS!
 * Use test/helpers/validate-email-server.js
 */

/**
 * Build HTML document
 *
 * @param {string} body
 */
export function buildDocument(body) {
  return /* html */ `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Storacha Email Validation</title>
  <meta name="description" content="">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script async src="https://js.stripe.com/v3/pricing-table.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@acab/reset.css">
  <link href="https://fonts.googleapis.com/css2?family=Epilogue:ital,wght@0,100..900;1,100..900&family=Fira+Code:wght@300..700&display=swap" rel="stylesheet">
  <style>
    :root {
      --hot-red: #E91315;
      --hot-red-light: #EFE3F3;
      --hot-yellow: #FFC83F;
      --hot-yellow-light: #FFE4AE;
      --hot-blue: #0176CE;
      --hot-blue-light: #BDE0FF;
    }

    body {
      color: black;
      background-color: var(--hot-red-light);
      font-family: 'Epilogue', sans-serif;
      max-width: 70rem;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 1.5rem;
    }

    h1 {
      color: var(--hot-red);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 1.5rem;
      line-height: 2rem;
    }

    h5 {
      color: var(--hot-red);
      font-size: 1rem;
      line-height: 1.5rem;
      margin-top: 1rem;
    }

    header {
      padding: 1rem 3rem 0;
    }

    main {
      padding: 0 3rem;
      text-align: center;
      width: 100%;
    }

    code {
      font-family: 'Fira Code';
      font-weight: 500;
    }

    pre > code {
      padding: 0.25rem 0;
      display: block;
      overflow-x: auto;
    }

    .box {
      border: 1px solid var(--hot-red);
      border-radius: 1rem;
      background-color: #FFFFFF;
      padding: 1.25rem;
      margin-top: 1rem;

      font-size: 0.875rem;
      line-height: 1.25rem;
    }
    .box > p {
      margin-bottom: 10px;
    }
    .box > p:last-child {
      margin-bottom: 0;
    }

    button {
      background-color: var(--hot-yellow-light);
      color: var(--hot-red);
      font-weight: 500;
      border: none;
      border-radius: 0.25rem;
      padding: 0.5rem 1rem;
      margin-top: 1rem;
    }
  </style>
</head>
<body>
  ${body}
</body>
</html>`
}

export class HtmlResponse extends Response {
  /**
   *
   * @param {import('preact').VNode<{}>} body
   * @param {ResponseInit} [init]
   */
  constructor(body, init = {}) {
    const headers = {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    }
    const stringBody = buildDocument(render(body))
    super(stringBody, { ...init, ...headers })
    this.stringBody = stringBody
  }

  getStringBody() {
    return this.stringBody
  }

  /**
   * @param {import('preact').VNode<{}>} body
   * @param {ResponseInit} [init]
   */
  static respond(body, init = {}) {
    return new HtmlResponse(body, init)
  }
}

/**
 *
 * @param {object} props
 * @param {boolean} [props.autoApprove]
 */
export const PendingValidateEmail = ({ autoApprove }) => (
  <>
    <header
      dangerouslySetInnerHTML={{
        __html: storachaLogoSvg,
      }}
    />
    <main>
      <div class="box">
        <h1>Validating Email</h1>
        <form id="approval" method="post">
          <button>Approve</button>
        </form>
        {autoApprove ? (
          <script
            dangerouslySetInnerHTML={{
              // NOTE: this script sticks to ES3-era syntax for compat with more browsers
              __html: `(function () {
            // auto-submit the form for any user w/JS enabled
            var form = document.getElementById('approval');
            form.style.display = 'none';
            form.submit();
          })();`,
            }}
          />
        ) : undefined}
      </div>
    </main>
  </>
)

/**
 *
 * @param {object} props
 * @param {string} props.ucan
 * @param {string} props.email
 * @param {string} props.audience
 * @param {string} [props.stripePricingTableId]
 * @param {string} [props.stripePublishableKey]
 */
export const ValidateEmail = ({
  ucan,
  email,
  audience,
  stripePricingTableId,
  stripePublishableKey,
}) => {
  const showPricingTable = stripePricingTableId && stripePublishableKey
  return (
    <>
      <header
        dangerouslySetInnerHTML={{
          __html: storachaLogoSvg,
        }}
      />
      <main>
        <div class="box">
          <h1>Email Validated</h1>
          <p>
            <code>{email}</code> was confirmed.{' '}
            {showPricingTable ? '' : 'You may close this window.'}
          </p>
        </div>
        {showPricingTable && (
          <div class="box">
            <p>
              In order to upload data you need to sign up for a billing plan:
            </p>
            <stripe-pricing-table
              pricing-table-id={stripePricingTableId}
              publishable-key={stripePublishableKey}
              customer-email={email}
            />
          </div>
        )}
        <div class="box">
          <p>
            By registering with Storacha you agree to the Storacha{' '}
            <a href="https://web3.storage/docs/terms/">Terms of Service</a>.
          </p>
        </div>
        <details class="box">
          {' '}
          <summary>Auth details</summary>
          <h5>Validation requested by</h5>
          <pre>
            <code>{audience}</code>
          </pre>
          <h5>UCAN</h5>
          <pre>
            <code>{ucan}</code>
          </pre>
        </details>
      </main>
    </>
  )
}

/**
 *
 * @param {object} props
 * @param {string} props.msg
 */
export const ValidateEmailError = ({ msg }) => (
  <>
    <header
      dangerouslySetInnerHTML={{
        __html: storachaLogoSvg,
      }}
    />
    <main>
      <div class="box">
        <h1>Email Validation Failed</h1>
        <p>{msg} You may close this window and try again.</p>
      </div>
    </main>
  </>
)
