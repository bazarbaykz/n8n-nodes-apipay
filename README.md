# n8n-nodes-apipay

[![npm version](https://img.shields.io/npm/v/n8n-nodes-apipay.svg)](https://www.npmjs.com/package/n8n-nodes-apipay)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-apipay.svg)](https://www.npmjs.com/package/n8n-nodes-apipay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![n8n community](https://img.shields.io/badge/n8n-community%20node-orange)](https://n8n.io)

This is an n8n community node for [ApiPay.kz](https://apipay.kz) — a Kaspi Pay payment gateway for Kazakhstan.

It allows you to create and manage invoices, refunds, subscriptions, and catalog items through the ApiPay.kz API directly in your n8n workflows.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Credentials

You need an ApiPay.kz account to use this node:

1. Register at [apipay.kz](https://apipay.kz)
2. Get your API Key from the dashboard
3. (Optional) Get Webhook Secret for the Trigger node
4. In n8n, create new ApiPay API credentials with your API Key

## Operations

### Invoice
- **Create** — Create a new Kaspi Pay invoice
- **Get** — Get invoice details by ID
- **Get Many** — List invoices with filters (status, date, search)
- **Cancel** — Cancel a pending invoice
- **Check Status** — Batch check statuses for up to 100 invoices

### Refund
- **Create** — Create a full or partial refund
- **Get** — Get refund details by ID
- **Get Many** — List refunds with filters
- **Get by Invoice** — Get all refunds for a specific invoice

### Subscription
- **Create** — Create a recurring payment subscription
- **Get** — Get subscription details
- **Get Many** — List subscriptions with filters
- **Update** — Update subscription parameters
- **Pause** — Pause an active subscription
- **Resume** — Resume a paused subscription
- **Cancel** — Permanently cancel a subscription
- **Get Invoices** — Get all invoices for a subscription

### Catalog
- **Get Units** — Get available measurement units
- **Get Many** — List catalog items
- **Create** — Batch create catalog items (up to 50)
- **Upload Image** — Upload an image for catalog items
- **Update** — Update a catalog item
- **Delete** — Delete a catalog item

### Status
- **Health Check** — Check API availability

### ApiPay Trigger
Receives webhook events from ApiPay.kz with HMAC-SHA256 signature verification:
- Invoice status changed
- Invoice refunded
- Subscription payment succeeded/failed
- Subscription grace period started
- Subscription expired
- Webhook test

## Compatibility

- n8n version: 1.0+
- Node.js: 18+

## Resources

- [ApiPay.kz Documentation](https://apipay.kz/docs)
- [n8n Community Nodes Documentation](https://docs.n8n.io/integrations/community-nodes/)
- [ApiPay.kz API Reference](https://github.com/bazarbaykz/apipay-docs)

## License

[MIT](LICENSE)
