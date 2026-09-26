# n8n-nodes-apipay

[![npm version](https://img.shields.io/npm/v/n8n-nodes-apipay.svg)](https://www.npmjs.com/package/n8n-nodes-apipay)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-apipay.svg)](https://www.npmjs.com/package/n8n-nodes-apipay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![n8n community](https://img.shields.io/badge/n8n-community%20node-orange)](https://n8n.io)

This is an n8n community node for [ApiPay.kz](https://apipay.kz) — an independent service that works on top of your own Kaspi Pay account in Kazakhstan. ApiPay is not an official Kaspi integration and not a Kaspi partner: it issues and tracks invoices through the standard "Cashier" role of Kaspi Pay.

It lets you issue and track invoices, refunds, subscriptions, fiscal receipts, printable QR sheets and cash shifts through the ApiPay.kz API directly in your n8n workflows.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Credentials

You need an ApiPay.kz account to use this node:

1. Register at [apipay.kz](https://apipay.kz)
2. Get your API Key from the dashboard
3. Generate a Webhook Secret next to the notification address — needed by the Trigger node and
   shown only once
4. In n8n, create new ApiPay API credentials with your API Key

## Operations

The node covers 67 API operations across 12 resources: Invoice, Refund, QR Refund, Subscription,
Catalog, Receipt, Static QR, Cashbox, Client, Webhook Log, Account and Status. The exact list,
with a hint on every field, is in the node itself; the API reference is at
[apipay.kz/docs](https://apipay.kz/docs).

Connecting a Kaspi Pay cashier is deliberately not among them: it needs an SMS code sent to the
employee's phone, so it is done by a person in the ApiPay dashboard.

### ApiPay Trigger

Receives all 22 ApiPay webhook events — invoices, refunds, QR refunds, subscriptions, fiscal
receipts, cash shifts and catalog intake — and verifies the HMAC-SHA256 signature itself.

⛔ Signature verification is on by default and the node refuses events it cannot verify. Set the
webhook secret in the credential: the webhook URL is public, so without a signature anyone who
knows the address can post a "paid" event into your workflow.

## Compatibility

- n8n version: 1.0+
- Node.js: 18+

## Resources

- [ApiPay.kz Documentation](https://apipay.kz/docs)
- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/community-nodes/)
- [ApiPay.kz API Reference](https://github.com/bazarbaykz/apipay-docs)

## License

[MIT](LICENSE)
