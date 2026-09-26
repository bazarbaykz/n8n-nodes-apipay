# Changelog

All notable changes to this node are documented here. The node follows the ApiPay API
contract; `npm run canon:check` verifies that it has not fallen behind.

## 0.2.0

### Breaking

- **Webhook signature verification is on by default.** An empty webhook secret used to mean
  "accept the event without checking it", and nothing said so. The webhook URL is public, so
  anyone who knew the address could post a `paid` event into a workflow. The trigger now
  refuses events it cannot verify; set the secret in the credential, or turn the check off
  with the explicit **Require Signature** toggle if you accept that risk.
- **The `Environment` field is gone from the credential.** It was never read. Sandbox is a
  property of the organisation behind the API key and is switched in the ApiPay dashboard, so
  a selector reading "Sandbox" next to a production key only created a false sense of safety.
  Use **Account → Get Health** to see which mode a key works in.

### Added

- Resources: **QR Refund**, **Receipt**, **Static QR**, **Cashbox**, **Client**,
  **Webhook Log**, **Account** — 67 operations across 12 resources in total.
- Invoice: Create Bulk, Create QR, Get Receipt, Get Stats, Update Note, plus
  `external_order_id_idempotency`, `internal_comment` and `kaspi_connection_id`, the `origin`
  and `date_field` filters and the `processing` status.
- Catalog: Bulk Delete, Scan, Get Queue, Get Errors, Get Webhook Logs.
- Subscription: the sandbox simulations.
- All 22 webhook events. Previously seven were offered and the rest were unreachable even as
  raw data: with a non-empty selection the trigger answers 200 and filters out anything not on
  the list.
- Dropdowns for catalog units and catalog positions instead of typing numeric IDs.
- Failed items now carry the refusal code, the per-field errors and `Retry-After` instead of
  only a message.

### Fixed

- **The catalog image upload never worked.** It was assembled in `request` style and went out
  as a JSON string instead of multipart.
- The amount on the phone-invoice route is whole tenge; a fractional value was rejected by the
  API. The QR route does accept tiyn and is unchanged.
- An invoice built from cart items no longer sends `amount: 0` alongside the cart, which the
  API refuses.
- The invoice description advertised 500 characters; Kaspi shows the customer the first 60 and
  rejects anything longer.
- The cashbox idempotency hint said to retry a failed shift close with the same key. The key is
  not released on failure — a retry needs a new one, otherwise the answer is 409.
- Catalog batch creation accepts 100 items, not 50. Subscription billing day is a day of the
  week (1-7) on weekly and biweekly periods, not a day of the month.

### Security

- `QR Refund → Execute` reads the class of the answer from the HTTP status rather than the body:
  `200` means the refund is proven, `202` means the attempt is spent and the outcome is **not**
  proven. The output carries `refundOutcome` and `doNotRetry`. Refusals that mean the money may
  already have moved are marked the same way, and they are told apart by error code rather than
  by HTTP family — `502` is a Kaspi refusal and may be retried.
- The refund link is a bearer link returned exactly once. The operation says to hand it to the
  customer and keep it out of execution history, logs and error reports.

## 0.1.1

Prepared as a hotfix and superseded by 0.2.0 before it was published — it was never released to
npm. Its content is included in 0.2.0.

## 0.1.0

First release.
