import type {
	IWebhookFunctions,
	IWebhookResponseData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
} from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'crypto';

export class ApiPayTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ApiPay Trigger',
		name: 'apiPayTrigger',
		icon: 'file:apipay.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when ApiPay.kz webhook events occur',
		defaults: { name: 'ApiPay Trigger' },
		usableAsTool: true,
		inputs: [],
		outputs: ['main'],
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
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: [],
				description: 'Which events to listen for',
				options: [
					{
						name: 'Invoice Refunded',
						value: 'invoice.refunded',
						description: 'When an invoice is fully or partially refunded',
					},
					{
						name: 'Invoice Status Changed',
						value: 'invoice.status_changed',
						description: 'When an invoice status changes (e.g., pending → paid)',
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
						name: 'Webhook Test',
						value: 'webhook.test',
						description: 'Test event sent from ApiPay dashboard',
					},
				],
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const rawBody = req.rawBody;
		const signature = this.getHeaderData()['x-webhook-signature'] as string;

		const credentials = await this.getCredentials('apiPayApi');
		const webhookSecret = credentials.webhookSecret as string;

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
