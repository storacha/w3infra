import fetch from '@web-std/fetch'

/**
 * @typedef { import('@web3-storage/upload-api').ValidationEmailSend } ValidationEmailSend
 */

/**
 * @param {{token:string, sender?:string}} opts
 */
export const configure = (opts) => new Email(opts)

export class Email {
  /**
   * @param {object} opts
   * @param {string} opts.token
   * @param {string} [opts.sender]
   */
  constructor(opts) {
    this.sender = opts.sender || 'web3.storage <noreply@web3.storage>'
    this.headers = {
      Accept: 'text/json',
      'Content-Type': 'text/json',
      'X-Postmark-Server-Token': opts.token,
    }
  }

  /**
   * Send validation email with ucan to register
   *
   * @param {ValidationEmailSend} opts
   */
  async sendValidation (opts) {
    console.warn('sending email')
    console.warn("with headers", this.headers)
    const rsp = await fetch('https://api.postmarkapp.com/email/withTemplate', {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        From: this.sender,
        To: opts.to,
        TemplateAlias: 'welcome',
        TemplateModel: {
          product_url: 'https://web3.storage',
          product_name: 'Web3 Storage',
          email: opts.to,
          action_url: opts.url,
        },
      }),
    })

    if (!rsp.ok) {
      throw new Error(
        `Send email failed with status: ${rsp.status
        }, body: ${await rsp.text()}`
      )
    }
  }
}
