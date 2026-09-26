import type {
	IHookFunctions,
	IWebhookFunctions,
	IWebhookResponseData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'crypto';

export class ApiPayTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ApiPay Trigger',
		name: 'apiPayTrigger',
		icon: 'file:apipay.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{($parameter["events"] || []).join(", ")}}',
		description: 'Starts the workflow when ApiPay.kz webhook events occur',
		defaults: { name: 'ApiPay Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'apiPayApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'Copy the Webhook URL above into the ApiPay dashboard: Settings → Connection → your API key → notification address. ApiPay has no API for registering it, so this step is done by hand once per key. Generate the webhook secret there too and put it in the credential.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description: 'Which events to listen for',
				options: [
					{
						name: 'Cashbox Shift Close Failed',
						value: 'cashbox.shift_close_failed',
						description: 'When closing a cash shift did not go through',
					},
					{
						name: 'Cashbox Shift Closed',
						value: 'cashbox.shift_closed',
						description: 'When a cash shift has been closed',
					},
					{
						name: 'Catalog Item Processed',
						value: 'catalog.item_processed',
						description: 'When one catalog position finished intake. Note these deliveries have their own log with a 3-day rotation.',
					},
					{
						name: 'Invoice QR Scanned',
						value: 'invoice.qr_scanned',
						description: 'When the customer scanned a QR invoice. ⚠️ This does NOT change the invoice status — the status in the payload is whatever it was when the event was sent.',
					},
					{
						name: 'Invoice Refunded',
						value: 'invoice.refunded',
						description: 'When an invoice is fully or partially refunded',
					},
					{
						name: 'Invoice Status Changed',
						value: 'invoice.status_changed',
						description: 'When an invoice reaches a notifiable status. ⚠️ The status is set by Kaspi, and cancelled → paid or expired → paid are valid sequences: do not close an order on a local timeout alone.',
					},
					{
						name: 'QR Refund Completed',
						value: 'qr_refund.completed',
						description: 'When a QR refund went through and is proven',
					},
					{
						name: 'QR Refund Execution Uncertain',
						value: 'qr_refund.execution_uncertain',
						description: '⛔ When the outcome of a refund is NOT proven — Kaspi may already have moved the money. Do not retry on this event: take the session to support.',
					},
					{
						name: 'QR Refund Expired',
						value: 'qr_refund.expired',
						description: 'When a refund link is used up: its window closed without a retry, the last window was missed, the link expired or it was revoked',
					},
					{
						name: 'QR Refund Failed',
						value: 'qr_refund.failed',
						description: 'When Kaspi refused the refund. The real reason is in error_code; the money did not move.',
					},
					{
						name: 'QR Refund Identified',
						value: 'qr_refund.identified',
						description: 'When the customer confirmed who they are on the refund link',
					},
					{
						name: 'Receipt Failed',
						value: 'receipt.failed',
						description: 'When a fiscal receipt could not be punched',
					},
					{
						name: 'Receipt Issued',
						value: 'receipt.issued',
						description: 'When a fiscal receipt has been punched',
					},
					{
						name: 'Subscription Cancelled',
						value: 'subscription.cancelled',
						description: 'When a subscription is cancelled',
					},
					{
						name: 'Subscription Created',
						value: 'subscription.created',
						description: 'When a subscription is created',
					},
					{
						name: 'Subscription Expired',
						value: 'subscription.expired',
						description: 'When a subscription expires after grace period',
					},
					{
						name: 'Subscription Grace Period Started',
						value: 'subscription.grace_period_started',
						description: 'When a subscription enters grace period after failed payment',
					},
					{
						name: 'Subscription Paused',
						value: 'subscription.paused',
						description: 'When a subscription is paused',
					},
					{
						name: 'Subscription Payment Failed',
						value: 'subscription.payment_failed',
						description: 'When a subscription payment fails',
					},
					{
						name: 'Subscription Payment Succeeded',
						value: 'subscription.payment_succeeded',
						description: 'When a subscription payment is successfully processed',
					},
					{
						name: 'Subscription Resumed',
						value: 'subscription.resumed',
						description: 'When a subscription is resumed',
					},
					{
						name: 'Webhook Test',
						value: 'webhook.test',
						description: 'Test event sent from the ApiPay dashboard',
					},
				],
			},
			{
				displayName: 'Require Signature',
				name: 'requireSignature',
				type: 'boolean',
				default: true,
				description: 'Whether to reject events that cannot be verified. ⛔ Leaving this off on a public webhook URL lets anyone POST a "paid" event to your workflow. Set the webhook secret in the credential — the ApiPay dashboard generates it next to the notification address.',
			},
		],
	};

	/**
	 * ApiPay registers webhooks nowhere: the notification address belongs to the API key and is
	 * set once in the dashboard, and the public API exposes no endpoint to read or change it.
	 * There is therefore no call to make from here — but n8n requires the three methods, and
	 * leaving them out is what its own rule for community nodes flags.
	 *
	 * So they are implemented with the only honest semantics available, and the person is told
	 * what to do by the notice at the top of the node rather than by a silent no-op.
	 */
	webhookMethods = {
		default: {
			/** Cannot be answered: nothing reports the address of a key. */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return false;
			},

			/** Nothing to create. The address is pasted into the dashboard by hand. */
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},

			/** Nothing was registered from here, so nothing is removed. */
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const rawBody = req.rawBody;
		const signature = this.getHeaderData()['x-webhook-signature'] as string;

		const credentials = await this.getCredentials('apiPayApi');
		const webhookSecret = credentials.webhookSecret as string;

		const requireSignature = this.getNodeParameter('requireSignature', true) as boolean;

		// With no secret there is nothing to verify. Accepting such a request silently is not an
		// option: the webhook URL is public, and anyone could post "paid".
		if (requireSignature && !webhookSecret) {
			return {
				webhookResponse: { status: 403, body: { error: 'Webhook secret is not configured' } },
				workflowData: undefined,
			};
		}

		if (webhookSecret) {
			if (!signature) {
				return {
					webhookResponse: { status: 403, body: { error: 'Invalid signature' } },
					workflowData: undefined,
				};
			}

			const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
			if (!isValid) {
				return {
					webhookResponse: { status: 403, body: { error: 'Invalid signature' } },
					workflowData: undefined,
				};
			}
		}

		const body = this.getBodyData() as IDataObject;

		const events = this.getNodeParameter('events', []) as string[];
		const eventType = body.event as string;

		if (events.length > 0 && !events.includes(eventType)) {
			return {
				webhookResponse: { status: 200, body: { received: true, filtered: true } },
				workflowData: undefined,
			};
		}

		return {
			workflowData: [this.helpers.returnJsonArray(body)],
		};
	}
}

function verifyWebhookSignature(
	rawBody: Buffer | string,
	signature: string,
	secret: string,
): boolean {
	try {
		const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
		const expectedBuf = Buffer.from(expected, 'utf8');
		const signatureBuf = Buffer.from(signature, 'utf8');
		if (expectedBuf.length !== signatureBuf.length) return false;
		return timingSafeEqual(expectedBuf, signatureBuf);
	} catch {
		return false;
	}
}
