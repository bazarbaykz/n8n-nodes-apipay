import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

import { API_BASE_URL } from './constants';

/**
 * Pulls the parts of an ApiPay failure a workflow can actually act on.
 *
 * ApiPay answers a refusal with `error_code`, a per-field `errors` map and, when the
 * rate limit is hit, `Retry-After`. None of that survives `error.message` alone, which
 * is all a failed item used to carry.
 */
function describeApiFailure(error: unknown): IDataObject {
	const err = error as {
		message?: string;
		httpCode?: string;
		description?: string;
		response?: { data?: unknown; body?: unknown; status?: number; headers?: IDataObject };
		cause?: { response?: { data?: unknown; body?: unknown; status?: number; headers?: IDataObject } };
	};

	const response = err.response ?? err.cause?.response;
	const body = (response?.data ?? response?.body) as IDataObject | undefined;
	const retryAfter = response?.headers?.['retry-after'];

	const details: IDataObject = { error: err.message ?? 'ApiPay request failed' };

	const httpCode = err.httpCode ?? (response?.status !== undefined ? String(response.status) : undefined);
	if (httpCode) {
		details.httpCode = httpCode;
	}
	if (err.description) {
		details.description = err.description;
	}
	if (body && typeof body === 'object') {
		if (body.error_code) {
			details.errorCode = body.error_code;
		}
		if (body.errors) {
			details.errors = body.errors;
		}
		if (body.meta) {
			details.meta = body.meta;
		}
	}
	if (retryAfter !== undefined) {
		details.retryAfter = retryAfter;
	}
	if (typeof details.errorCode === 'string' && QR_REFUND_MONEY_UNPROVEN.has(details.errorCode)) {
		details.refundOutcome = 'unproven';
		details.doNotRetry = true;
	}

	return details;
}

/**
 * Refusals of a QR refund that mean Kaspi MAY ALREADY have moved the money.
 *
 * ⛔ A retry on any of these can refund twice. They are listed by code and not by HTTP
 * family on purpose: here `502` means "Kaspi refused" and is retryable, while "nobody knows
 * what happened" arrives as `202` — a family-based guess gets it exactly backwards.
 */
const QR_REFUND_MONEY_UNPROVEN = new Set([
	'qr_refund_execution_uncertain',
	'qr_refund_execution_result_unavailable',
	'qr_refund_execution_in_progress',
]);

/** Cart lines, shared by the phone, QR and printable-sheet routes. */
function cartItemsFrom(additionalFields: IDataObject): IDataObject[] | undefined {
	if (!additionalFields.cartItems) return undefined;
	const list = ((additionalFields.cartItems as IDataObject).item as IDataObject[]) || [];
	if (!list.length) return undefined;
	return list.map((item) => ({
		catalog_item_id: item.catalogItemId,
		count: item.count,
		...(item.price ? { price: item.price } : {}),
	}));
}

async function apiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestOptions['method'],
	endpoint: string,
	body: IDataObject | FormData = {},
	qs: IDataObject = {},
): Promise<IDataObject | IDataObject[]> {
	const isMultipart = body instanceof FormData;
	const options: IHttpRequestOptions = {
		url: `${API_BASE_URL}${endpoint}`,
		method,
		body: isMultipart ? body : Object.keys(body).length ? body : undefined,
		qs: Object.keys(qs).length ? qs : undefined,
		// Multipart must not be JSON-encoded; axios sets the boundary from the FormData.
		json: isMultipart ? undefined : true,
	};
	return await this.helpers.httpRequestWithAuthentication.call(this, 'apiPayApi', options) as IDataObject | IDataObject[];
}

/**
 * Moves money. The class of the answer is decided by the TRANSPORT, not by the body.
 *
 * `200` — the refund happened and is proven. `202` — the attempt is spent and the outcome is
 * NOT proven: Kaspi may or may not have applied it, and repeating the request can refund
 * twice. The two cannot be told apart by looking at the fields: one of the `202` codes ships
 * no session snapshot at all, deliberately. Hence `returnFullResponse`.
 */
async function executeQrRefund(
	this: IExecuteFunctions,
	sessionId: number,
	body: IDataObject,
): Promise<IDataObject> {
	const response = await this.helpers.httpRequestWithAuthentication.call(this, 'apiPayApi', {
		url: `${API_BASE_URL}/qr-refunds/${sessionId}/execute`,
		method: 'POST',
		body,
		json: true,
		returnFullResponse: true,
	}) as { statusCode: number; body: IDataObject };

	const proven = response.statusCode === 200;
	return {
		refundOutcome: proven ? 'proven' : 'unproven',
		doNotRetry: !proven,
		httpCode: String(response.statusCode),
		...(response.body ?? {}),
	};
}

/**
 * Flat pagination — `{current_page, data, total}`, the shape most list routes answer with.
 *
 * `total` is the guard: paging until a short page came back forever if the server ever
 * ignored `per_page`, and every extra round trip is another hit against the rate limit.
 */
async function paginate(
	this: IExecuteFunctions,
	endpoint: string,
	qs: IDataObject,
	returnAll: boolean,
	limit: number,
): Promise<IDataObject[]> {
	if (!returnAll) {
		const response = await apiRequest.call(this, 'GET', endpoint, {}, { ...qs, page: 1, per_page: limit }) as IDataObject;
		return (response.data as IDataObject[]) || [];
	}

	const collected: IDataObject[] = [];
	let page = 1;
	for (;;) {
		const response = await apiRequest.call(this, 'GET', endpoint, {}, { ...qs, page, per_page: 100 }) as IDataObject;
		const data = (response.data as IDataObject[]) || [];
		collected.push(...data);

		const total = typeof response.total === 'number' ? response.total : undefined;
		if (data.length < 100 || (total !== undefined && collected.length >= total)) break;
		page++;
	}
	return collected;
}

/**
 * Read-only fetch for the dropdowns. Separate from `apiRequest` because the load-options
 * context is `ILoadOptionsFunctions`, not `IExecuteFunctions`.
 *
 * ⚠️ Registered in KNOWN_WRAPPERS in scripts/check-canon-drift.mjs. The gate counts direct
 * calls to the request helper and fails when a new wrapper appears unannounced.
 */
async function loadOptionsRequest(
	this: ILoadOptionsFunctions,
	endpoint: string,
	qs: IDataObject = {},
): Promise<IDataObject> {
	return await this.helpers.httpRequestWithAuthentication.call(this, 'apiPayApi', {
		url: `${API_BASE_URL}${endpoint}`,
		method: 'GET',
		qs: Object.keys(qs).length ? qs : undefined,
		json: true,
	}) as IDataObject;
}

export class ApiPay implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ApiPay',
		name: 'apiPay',
		icon: 'file:apipay.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with ApiPay.kz Kaspi Pay API',
		defaults: { name: 'ApiPay' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'apiPayApi', required: true }],
		properties: [
			// ──────────────────────────────────────
			// Resource selector
			// ──────────────────────────────────────
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Cashbox', value: 'cashbox' },
					{ name: 'Catalog', value: 'catalog' },
					{ name: 'Client', value: 'client' },
					{ name: 'Invoice', value: 'invoice' },
					{ name: 'QR Refund', value: 'qrRefund' },
					{ name: 'Receipt', value: 'receipt' },
					{ name: 'Refund', value: 'refund' },
					{ name: 'Static QR', value: 'staticQr' },
					{ name: 'Status', value: 'status' },
					{ name: 'Subscription', value: 'subscription' },
					{ name: 'Webhook Log', value: 'webhookLog' },
				],
				default: 'invoice',
			},

			// ──────────────────────────────────────
			// Operations: Invoice
			// ──────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['invoice'] },
				},
				options: [
					{ name: 'Cancel', value: 'cancel', description: 'Cancel an invoice', action: 'Cancel an invoice' },
					{ name: 'Check Status', value: 'checkStatus', description: 'Check invoice statuses', action: 'Check invoice statuses' },
					{ name: 'Create', value: 'create', description: 'Create an invoice for a phone number. ⚠️ Add an Idempotency Key in Additional Fields if this workflow can be retried — without it a retry bills the customer twice.', action: 'Create an invoice' },
					{ name: 'Create Bulk', value: 'createBulk', description: 'Create up to 100 invoices in one request. ⚠️ Give every line its own idempotency key if the batch can be re-run — without it a re-run bills everyone twice.', action: 'Create invoices in bulk' },
					{ name: 'Create QR', value: 'createQr', description: 'Create an invoice paid by scanning a QR code at the till', action: 'Create a QR invoice' },
					{ name: 'Get', value: 'get', description: 'Get an invoice', action: 'Get an invoice' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many invoices', action: 'Get many invoices' },
					{ name: 'Get Receipt', value: 'getReceipt', description: 'Get the Kaspi receipt links for a paid invoice', action: 'Get the receipt of an invoice' },
					{ name: 'Get Stats', value: 'getStats', description: 'Get invoice statistics for a period', action: 'Get invoice statistics' },
					{ name: 'Simulate Status', value: 'simulateStatus', description: 'Sandbox only: move an invoice to a status', action: 'Simulate an invoice status' },
					{ name: 'Update Note', value: 'updateNote', description: 'Change the internal note of an invoice', action: 'Update the note of an invoice' },
				],
				default: 'create',
			},

			// ──────────────────────────────────────
			// Operations: Refund
			// ──────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['refund'] },
				},
				options: [
					{ name: 'Create', value: 'create', description: 'Create a refund', action: 'Create a refund' },
					{ name: 'Get', value: 'get', description: 'Get a refund', action: 'Get a refund' },
					{ name: 'Get by Invoice', value: 'getByInvoice', description: 'Get refunds by invoice', action: 'Get refunds by invoice' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many refunds', action: 'Get many refunds' },
				],
				default: 'create',
			},

			// ──────────────────────────────────────
			// Operations: Subscription
			// ──────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['subscription'] },
				},
				options: [
					{ name: 'Cancel', value: 'cancel', description: 'Cancel a subscription', action: 'Cancel a subscription' },
					{ name: 'Create', value: 'create', description: 'Create a subscription', action: 'Create a subscription' },
					{ name: 'Get', value: 'get', description: 'Get a subscription', action: 'Get a subscription' },
					{ name: 'Get Invoices', value: 'getInvoices', description: 'Get subscription invoices', action: 'Get subscription invoices' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many subscriptions', action: 'Get many subscriptions' },
					{ name: 'Pause', value: 'pause', description: 'Pause a subscription', action: 'Pause a subscription' },
					{ name: 'Resume', value: 'resume', description: 'Resume a subscription', action: 'Resume a subscription' },
					{ name: 'Simulate Invoice', value: 'simulateInvoice', description: 'Sandbox only: create one invoice for a subscription. Cooldown of 30 seconds between calls. For a subscription with a cart the sum comes from current catalog prices, not from the stored amount.', action: 'Simulate a subscription invoice' },
					{ name: 'Start Simulation', value: 'startSimulation', description: 'Sandbox only: generate subscription invoices on an interval', action: 'Start a subscription simulation' },
					{ name: 'Stop Simulation', value: 'stopSimulation', description: 'Sandbox only: stop generating subscription invoices', action: 'Stop a subscription simulation' },
					{ name: 'Update', value: 'update', description: 'Update a subscription', action: 'Update a subscription' },
				],
				default: 'create',
			},

			// ──────────────────────────────────────
			// Operations: Catalog
			// ──────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['catalog'] },
				},
				options: [
					{ name: 'Bulk Delete', value: 'bulkDelete', description: 'Take many catalog positions off sale in one request', action: 'Bulk delete catalog items' },
					{ name: 'Create', value: 'create', description: 'Create catalog items', action: 'Create catalog items' },
					{ name: 'Delete', value: 'delete', description: 'Delete a catalog item', action: 'Delete a catalog item' },
					{ name: 'Get Errors', value: 'getErrors', description: 'Get catalog intake errors', action: 'Get catalog errors' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many catalog items', action: 'Get many catalog items' },
					{ name: 'Get Queue', value: 'getQueue', description: 'Get what is left in the catalog intake queue and its ETA', action: 'Get the catalog queue' },
					{ name: 'Get Units', value: 'getUnits', description: 'Get catalog units', action: 'Get catalog units' },
					{ name: 'Get Webhook Logs', value: 'getWebhookLogs', description: 'Get deliveries of the catalog.item_processed webhook', action: 'Get catalog webhook logs' },
					{ name: 'Scan', value: 'scan', description: 'Resolve a barcode in the Kaspi national catalogue', action: 'Scan a barcode' },
					{ name: 'Update', value: 'update', description: 'Update a catalog item', action: 'Update a catalog item' },
					{ name: 'Upload Image', value: 'uploadImage', description: 'Upload a catalog image', action: 'Upload a catalog image' },
				],
				default: 'getAll',
			},

			// ──────────────────────────────────────
			// Operations: Status
			// ──────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['account'] },
				},
				options: [
					{ name: 'Get Health', value: 'getHealth', description: 'Get the health of your ApiPay account, including whether the Kaspi session is alive', action: 'Get account health' },
					{ name: 'Get Plans', value: 'getPlans', description: 'Get the catalogue of ApiPay tariffs and plans', action: 'Get tariff plans' },
					{ name: 'Get Tariff', value: 'getTariff', description: 'Get the status of your ApiPay subscription', action: 'Get your tariff' },
				],
				default: 'getHealth',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['cashbox'] },
				},
				options: [
					{ name: 'Close Shift', value: 'closeShift', description: 'Close a Kaspi cash shift', action: 'Close a cash shift' },
					{ name: 'Get Operation', value: 'getOperation', description: 'Poll the status of a cashbox operation', action: 'Get a cashbox operation' },
					{ name: 'Get Reconciliation', value: 'getReconciliation', description: 'Reconcile ApiPay invoices against the Kaspi cashbox for one shift', action: 'Get a cashbox reconciliation' },
					{ name: 'Get Settings', value: 'getSettings', description: 'Read the cashbox toggles', action: 'Get cashbox settings' },
					{ name: 'Get Shift Report', value: 'getShiftReport', description: 'Get a link to the PDF report of a shift', action: 'Get a shift report' },
					{ name: 'Get Shifts', value: 'getShifts', description: 'List Kaspi cash shifts in a date window', action: 'Get cash shifts' },
					{ name: 'Get Summary', value: 'getSummary', description: 'Get the cash summary for a day', action: 'Get a cash summary' },
					{ name: 'Set Auto Close', value: 'setAutoClose', description: 'Turn automatic shift closing on or off', action: 'Set auto close' },
					{ name: 'Set Auto Withdrawal', value: 'setAutoWithdrawal', description: 'Turn automatic cash withdrawal on or off', action: 'Set auto withdrawal' },
				],
				default: 'getSummary',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['client'] },
				},
				options: [
					{ name: 'Check', value: 'check', description: 'Check whether a phone number is registered in Kaspi', action: 'Check a client phone number' },
				],
				default: 'check',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['webhookLog'] },
				},
				options: [
					{ name: 'Get', value: 'get', description: 'Get one webhook delivery with its full request and response bodies', action: 'Get a webhook delivery' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many webhook deliveries', action: 'Get many webhook deliveries' },
				],
				default: 'getAll',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['qrRefund'] },
				},
				options: [
					{ name: 'Create Link', value: 'createLink', description: 'Issue a one-time refund link to send to the customer. ⛔ The link comes back in this one answer only and is a bearer link: whoever opens it can confirm the refund. Hand it straight to the customer and keep it out of execution history, logs and error reports — turn off saving successful executions for this workflow.', action: 'Create a refund link' },
					{ name: 'Execute', value: 'execute', description: 'Move the money for a refund session the customer has confirmed', action: 'Execute a refund' },
					{ name: 'Get', value: 'get', description: 'Get the state of a refund session', action: 'Get a refund session' },
					{ name: 'Get Operation', value: 'getOperation', description: 'Get one returnable operation of the customer', action: 'Get a returnable operation' },
					{ name: 'Get Operations', value: 'getOperations', description: 'List the returnable operations of the identified customer', action: 'Get returnable operations' },
					{ name: 'Revoke Link', value: 'revokeLink', description: 'Revoke a refund link the customer has not confirmed yet', action: 'Revoke a refund link' },
					{ name: 'Simulate', value: 'simulate', description: 'Sandbox only: move a refund session to a state', action: 'Simulate a refund session' },
				],
				default: 'createLink',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['receipt'] },
				},
				options: [
					{ name: 'Get', value: 'get', description: 'Get a fiscal receipt', action: 'Get a fiscal receipt' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many fiscal receipts', action: 'Get many fiscal receipts' },
					{ name: 'Issue', value: 'issue', description: 'Issue a fiscal receipt for cash or an outside POS', action: 'Issue a fiscal receipt' },
					{ name: 'Preview', value: 'preview', description: 'Preview a fiscal receipt before issuing it', action: 'Preview a fiscal receipt' },
				],
				default: 'issue',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['staticQr'] },
				},
				options: [
					{ name: 'Create', value: 'create', description: 'Create a printable QR sheet for one deal', action: 'Create a printable QR sheet' },
					{ name: 'Disable', value: 'disable', description: 'Disable a printable QR sheet', action: 'Disable a printable QR sheet' },
					{ name: 'Get', value: 'get', description: 'Get a printable QR sheet', action: 'Get a printable QR sheet' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many printable QR sheets', action: 'Get many printable QR sheets' },
				],
				default: 'create',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: { resource: ['status'] },
				},
				options: [
					{ name: 'Health Check', value: 'healthCheck', description: 'Check API health', action: 'Check API health' },
				],
				default: 'healthCheck',
			},

			// ══════════════════════════════════════
			// Fields: Invoice
			// ══════════════════════════════════════

			// -- Invoice: Create --
			{
				displayName: 'Amount',
				name: 'amount',
				type: 'number',
				default: 0,
				required: true,
				typeOptions: { minValue: 0, maxValue: 99999999, numberPrecision: 0 },
				description: 'Invoice amount in whole tenge — fractional amounts are rejected on this route. Leave at 0 when cart items are provided: the server totals the cart and ignores this field.',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['create'] },
				},
			},
			{
				displayName: 'Phone Number',
				name: 'phoneNumber',
				type: 'string',
				default: '',
				required: true,
				placeholder: '87001234567',
				description: 'Customer phone number in format 8XXXXXXXXXX',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['create'] },
				},
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				description: 'Text the customer sees in Kaspi. Keep it to 60 characters — Kaspi only displays the first 60 and longer text is rejected.',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['create'] },
				},
			},
			{
				displayName: 'External Order ID',
				name: 'externalOrderId',
				type: 'string',
				default: '',
				description: 'Your external order identifier (max 255 characters)',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['create'] },
				},
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['invoice'], operation: ['create'] },
				},
				options: [
					{
						displayName: 'Cart Items',
						name: 'cartItems',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						options: [
							{
								displayName: 'Item',
								name: 'item',
								values: [
									{
										displayName: 'Catalog Item Name or ID',
										name: 'catalogItemId',
										type: 'options',
										typeOptions: { loadOptionsMethod: 'getCatalogItems' },
										default: 0,
										description: 'ID of the catalog item. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
									},
									{
										displayName: 'Count',
										name: 'count',
										type: 'number',
										default: 1,
										description: 'Quantity of the item',
									},
									{
										displayName: 'Price',
										name: 'price',
										type: 'number',
										default: 0,
										description: 'Custom price for the item (optional)',
									},
								],
							},
						],
					},
					{
						displayName: 'Discount Percentage',
						name: 'discountPercentage',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 99 },
						default: 0,
						description: 'Discount percentage (1-99)',
					},
					{
						displayName: 'Idempotency Key',
						name: 'externalOrderIdIdempotency',
						type: 'string',
						default: '',
						description: 'Re-running the workflow with the same key answers 409 instead of issuing a second invoice. Without it a retry bills the customer twice.',
					},
					{
						displayName: 'Internal Comment',
						name: 'internalComment',
						type: 'string',
						default: '',
						description: 'Note for your own records, up to 255 characters. Never sent to Kaspi and never shown to the payer.',
					},
					{
						displayName: 'Kaspi Connection ID',
						name: 'kaspiConnectionId',
						type: 'number',
						default: 0,
						description: 'Which connected cashier to bill through. Required when the organisation has more than one active cashier and no primary one, otherwise the request is refused with connection_ambiguous.',
					},
				],
			},


			// -- Invoice: Create QR --
			// `static: true` is deliberately not exposed here: in that mode the endpoint
			// returns a payment link instead of an invoice, and two response shapes behind one
			// operation is a trap for a workflow. The printable-sheet path is the Static QR
			// resource below, which covers the same ground with its own output.
			{
				displayName: 'Amount',
				name: 'amount',
				type: 'number',
				default: 0,
				required: true,
				typeOptions: { minValue: 0, maxValue: 99999999.99, numberPrecision: 2 },
				description: 'Amount to charge. Unlike an invoice sent to a phone number, the QR route accepts tiyn. Leave at 0 when cart items are provided: the server totals the cart and ignores this field.',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['createQr'] },
				},
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				description: 'Line name in the Kaspi receipt, up to 100 characters',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['createQr'] },
				},
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['invoice'], operation: ['createQr'] },
				},
				options: [
					{
						displayName: 'Cart Items',
						name: 'cartItems',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						description: 'Positions from the synced catalog. Required for merchants who have a catalog — such an organisation cannot issue a QR invoice with a bare amount.',
						options: [
							{
								displayName: 'Item',
								name: 'item',
								values: [
									{
										displayName: 'Catalog Item Name or ID',
										name: 'catalogItemId',
										type: 'options',
										typeOptions: { loadOptionsMethod: 'getCatalogItems' },
										default: 0,
										description: 'ID of the catalog item. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
									},
									{
										displayName: 'Count',
										name: 'count',
										type: 'number',
										default: 1,
										description: 'Quantity of the item',
									},
									{
										displayName: 'Price',
										name: 'price',
										type: 'number',
										default: 0,
										description: 'Price for this line, overriding the catalog price (optional)',
									},
								],
							},
						],
					},
					{
						displayName: 'Discount Percentage',
						name: 'discountPercentage',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 99 },
						default: 0,
						description: 'Discount percentage (1-99)',
					},
					{
						displayName: 'External Order ID',
						name: 'externalOrderId',
						type: 'string',
						default: '',
						description: 'Your own order identifier, echoed back in the webhook',
					},
					{
						displayName: 'Idempotency Key',
						name: 'externalOrderIdIdempotency',
						type: 'string',
						default: '',
						description: 'Re-running the workflow with the same key answers 409 instead of issuing a second QR. Without it a retry bills the customer twice.',
					},
					{
						displayName: 'Internal Comment',
						name: 'internalComment',
						type: 'string',
						default: '',
						description: 'Note for your own records, up to 255 characters. Never sent to Kaspi and never shown to the customer.',
					},
					{
						displayName: 'Kaspi Connection ID',
						name: 'kaspiConnectionId',
						type: 'number',
						default: 0,
						description: 'Which connected cashier to bill through. Required when the organisation has more than one active cashier and no primary one, otherwise the request is refused with connection_ambiguous.',
					},
					{
						displayName: 'Simulate Status',
						name: 'simulate',
						type: 'options',
						options: [
							{ name: 'Cancelled', value: 'cancelled' },
							{ name: 'Expired', value: 'expired' },
							{ name: 'Paid', value: 'paid' },
						],
						default: 'paid',
						description: 'Sandbox only: move the new QR invoice straight to this status',
					},
				],
			},



			// -- Invoice: Create Bulk --
			{
				displayName: 'Invoices',
				name: 'invoices',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				required: true,
				description: 'Up to 100 invoices in one request. ⚠️ The answer stays 201 even when individual lines fail — read the per-line error_code in the response instead of trusting the status.',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['createBulk'] },
				},
				options: [
					{
						displayName: 'Invoice',
						name: 'invoice',
						values: [
							{
						displayName: 'Amount',
						name: 'amount',
						type: 'number',
						default: 0,
						description: 'Whole tenge. A fractional amount fails that line with amount_must_be_whole_tenge.',
							},
							{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: '',
						description: 'Keep it to 60 characters	—	longer fails the line with description_too_long. Omit it and the server fills it from the cart or a default.',
							},
							{
						displayName: 'External Order ID',
						name: 'externalOrderId',
						type: 'string',
						default: '',
						description: 'Your own order identifier, echoed back in the webhook',
							},
							{
						displayName: 'Idempotency Key',
						name: 'externalOrderIdIdempotency',
						type: 'string',
						default: '',
						description: 'Per-line idempotency key. Without it a re-run of the batch bills everyone twice.',
							},
							{
						displayName: 'Internal Comment',
						name: 'internalComment',
						type: 'string',
						default: '',
						description: 'Note for your own records, never sent to Kaspi',
							},
							{
						displayName: 'Phone Number',
						name: 'phoneNumber',
						type: 'string',
						default: '',
						placeholder: '87001234567',
						description: 'Customer phone number in format 8XXXXXXXXXX',
							},
						],
					},
				],
			},
			{
				displayName: 'Kaspi Connection ID',
				name: 'kaspiConnectionId',
				type: 'number',
				default: 0,
				description: 'Which connected cashier to bill the whole batch through. Defaults to the primary one.',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['createBulk'] },
				},
			},

			// -- Invoice: Get Stats --
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: { resource: ['invoice'], operation: ['getStats'] },
				},
				options: [
					{
						displayName: 'Date Field',
						name: 'dateField',
						type: 'options',
						options: [
							{ name: 'Created At', value: 'created_at' },
							{ name: 'Paid At', value: 'paid_at' },
						],
						default: 'created_at',
						description: 'Which date the period applies to',
					},
					{
						displayName: 'End Date',
						name: 'endDate',
						type: 'string',
						default: '',
						placeholder: '2026-09-25',
						description: 'End of a custom window; use instead of Period',
					},
					{
						displayName: 'Origin',
						name: 'origin',
						type: 'options',
						options: [
							{ name: 'All', value: 'all' },
							{ name: 'ApiPay', value: 'apipay' },
							{ name: 'Kaspi', value: 'kaspi' },
						],
						default: 'all',
						description: 'Whether to include invoices that came from the Kaspi history sync',
					},
					{
						displayName: 'Period',
						name: 'period',
						type: 'options',
						options: [
							{ name: 'Month', value: 'month' },
							{ name: 'Today', value: 'today' },
							{ name: 'Week', value: 'week' },
							{ name: 'Year', value: 'year' },
						],
						default: 'month',
						description: 'Ready-made window instead of explicit dates',
					},
					{
						displayName: 'Search',
						name: 'search',
						type: 'string',
						default: '',
						description: 'Search across description, phone and external order ID',
					},
					{
						displayName: 'Start Date',
						name: 'startDate',
						type: 'string',
						default: '',
						placeholder: '2026-09-01',
						description: 'Start of a custom window; use instead of Period',
					},
				],
			},

			// -- Invoice: Update Note --
			{
				displayName: 'Invoice ID',
				name: 'invoiceId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the invoice to annotate. Works in any status, including paid and expired — a closed invoice can still be labelled.',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['updateNote'] },
				},
			},
			{
				displayName: 'Internal Comment',
				name: 'internalComment',
				type: 'string',
				default: '',
				description: 'New note, up to 255 characters. An empty value erases it. Never sent to Kaspi and never shown to the payer; this operation raises no webhook.',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['updateNote'] },
				},
			},

			// -- Invoice: Simulate Status --
			{
				displayName: 'Invoice ID',
				name: 'invoiceId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the invoice to move',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['simulateStatus'] },
				},
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Cancelled', value: 'cancelled' },
					{ name: 'Error', value: 'error' },
					{ name: 'Expired', value: 'expired' },
					{ name: 'Paid', value: 'paid' },
					{ name: 'QR Scanned', value: 'qr_scanned' },
				],
				default: 'paid',
				required: true,
				description: 'Status to move the invoice to. Sandbox only — a live organisation is refused.',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['simulateStatus'] },
				},
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['invoice'], operation: ['simulateStatus'] },
				},
				options: [
					{
						displayName: 'Error Message',
						name: 'errorMessage',
						type: 'string',
						default: '',
						description: 'Text to attach when simulating the error status',
					},
					{
						displayName: 'Kaspi Sale Type',
						name: 'kaspiSaleType',
						type: 'options',
						options: [
							{ name: 'QR', value: 'QR' },
							{ name: 'Remote', value: 'Remote' },
							{ name: 'Restaurant', value: 'Restaurant' },
							{ name: 'Static', value: 'Static' },
						],
						default: 'Remote',
						description: 'Which sale type Kaspi should report',
					},
					{
						displayName: 'Kaspi Source Type',
						name: 'kaspiSourceType',
						type: 'options',
						options: [
							{ name: 'Bank Integration Account', value: 'BANKINTEGRATIONACCOUNT' },
							{ name: 'Business Account', value: 'BUSINESSACCOUNT' },
							{ name: 'Gold', value: 'GOLD' },
							{ name: 'Loan', value: 'LOAN' },
							{ name: 'Red', value: 'RED' },
						],
						default: 'GOLD',
						description: 'Which payment source Kaspi should report',
					},
				],
			},

			// -- Invoice: Get Receipt --
			{
				displayName: 'Invoice ID',
				name: 'invoiceId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of a paid invoice. The answer is asynchronous: the first call returns status "pending" together with poll_after, and the same call returns status "ready" once Kaspi has answered — branch on status rather than assuming links are present.',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['getReceipt'] },
				},
			},



			// ══════════════════════════════════════
			// Fields: QR Refund
			// ══════════════════════════════════════

			// -- QR Refund: Create Link --
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['qrRefund'], operation: ['createLink'] },
				},
				options: [
					{
						displayName: 'Amount',
						name: 'amount',
						type: 'string',
						default: '',
						placeholder: '500.00',
						description: 'Partial refund as a flat sum, at most two decimals. Requires Invoice ID and is mutually exclusive with Return Items. Omit both to refund the whole remainder of the invoice.',
					},
					{
						displayName: 'Invoice ID',
						name: 'invoiceId',
						type: 'number',
						default: 0,
						description: 'ID of a paid invoice of this organisation. A link tied to an invoice carries the refund out by itself once the customer confirms; a link without one only identifies the customer and needs Execute.',
					},
					{
						displayName: 'Kaspi Connection ID',
						name: 'kaspiConnectionId',
						type: 'number',
						default: 0,
						description: 'Which connected cashier the refund belongs to. Fixed at issue time and never revisited.',
					},
					{
						displayName: 'Return Items',
						name: 'returnItems',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						description: 'Partial refund by position, discount taken into account. Requires Invoice ID and is mutually exclusive with Amount. Exactly one of Count or Amount per line.',
						options: [
							{
								displayName: 'Item',
								name: 'item',
								values: [
									{
										displayName: 'Catalog Item Name or ID',
										name: 'catalogItemId',
										type: 'options',
										typeOptions: { loadOptionsMethod: 'getCatalogItems' },
										default: 0,
										description: 'ID of the catalog item being returned. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
									},
									{
										displayName: 'Count',
										name: 'count',
										type: 'number',
										default: 0,
										description: 'How many units to return. Leave at 0 to give a sum instead.',
									},
									{
										displayName: 'Amount',
										name: 'amount',
										type: 'number',
										default: 0,
										description: 'Sum to return for this position instead of a count',
									},
								],
							},
						],
					},
				],
			},

			// -- QR Refund: Revoke Link --
			{
				displayName: 'Refund Link ID',
				name: 'linkId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the refund link to revoke. Revoking is idempotent. ⚠️ If the customer has already opened a scan window, the answer is still 200 but that window lives out its time: a refund confirmed inside it goes through. No new windows open afterwards. Once the customer has confirmed themselves the link cannot be revoked at all.',
				displayOptions: {
					show: { resource: ['qrRefund'], operation: ['revokeLink'] },
				},
			},

			// -- QR Refund: session-scoped operations --
			{
				displayName: 'Session ID',
				name: 'sessionId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the refund session',
				displayOptions: {
					show: {
						resource: ['qrRefund'],
						operation: ['get', 'getOperations', 'getOperation', 'execute', 'simulate'],
					},
				},
			},
			{
				displayName: 'Cursor',
				name: 'cursor',
				type: 'string',
				default: '',
				description: 'Opaque cursor from a previous page of operations',
				displayOptions: {
					show: { resource: ['qrRefund'], operation: ['getOperations'] },
				},
			},
			{
				displayName: 'Operation Ref',
				name: 'operationRef',
				type: 'string',
				default: '',
				required: true,
				description: 'Opaque operation_ref taken from Get Operations',
				displayOptions: {
					show: { resource: ['qrRefund'], operation: ['getOperation', 'execute'] },
				},
			},

			// -- QR Refund: Execute --
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['qrRefund'], operation: ['execute'] },
				},
				options: [
					{
						displayName: 'Amount',
						name: 'amount',
						type: 'number',
						default: 0,
						description: 'Partial refund as a sum. Mutually exclusive with Items. Omit both for a full refund.',
					},
					{
						displayName: 'Items',
						name: 'items',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						description: 'Partial refund by position of the original operation. Mutually exclusive with Amount.',
						options: [
							{
								displayName: 'Item',
								name: 'item',
								values: [
									{
										displayName: 'Ref',
										name: 'ref',
										type: 'string',
										default: '',
										description: 'Opaque ref of the position, from Get Operation',
									},
									{
										displayName: 'Amount',
										name: 'amount',
										type: 'number',
										default: 0,
										description: 'Sum to return for this position. Leave at 0 for the whole available amount.',
									},
								],
							},
						],
					},
					{
						displayName: 'Simulate Error Code',
						name: 'simulateErrorCode',
						type: 'options',
						options: [
							{ name: 'Amount Exceeds Available', value: 'refund_amount_exceeds_available' },
							{ name: 'Insufficient Funds', value: 'refund_insufficient_funds' },
							{ name: 'Kaspi Error', value: 'kaspi_error' },
							{ name: 'Operation Not Returnable', value: 'operation_not_returnable' },
							{ name: 'Session Expired', value: 'qr_refund_expired' },
						],
						default: 'kaspi_error',
						description: 'Sandbox only: which failure to force when Simulate Status is failed',
					},
					{
						displayName: 'Simulate Status',
						name: 'simulateStatus',
						type: 'options',
						options: [
							{ name: 'Completed', value: 'completed' },
							{ name: 'Failed', value: 'failed' },
						],
						default: 'completed',
						description: 'Sandbox only: force the outcome. A live organisation answers 403 not_sandbox.',
					},
				],
			},

			// -- QR Refund: Simulate --
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				options: [
					{ name: 'Customer Identified', value: 'identified' },
					{ name: 'Session Expired', value: 'expired' },
				],
				default: 'identified',
				required: true,
				description: 'Which transition to force. Sandbox only — a live organisation answers 403 not_sandbox. Note the sandbox cannot reproduce an unproven outcome: it has no irreversible operation.',
				displayOptions: {
					show: { resource: ['qrRefund'], operation: ['simulate'] },
				},
			},


			// ══════════════════════════════════════
			// Fields: Cashbox
			// ══════════════════════════════════════
			// Every cashbox route shares one extra minute limit — 30/min, stricter than the
			// general one. A workflow that polls an operation in a tight loop burns it.
			{
				displayName: 'Date',
				name: 'date',
				type: 'string',
				default: '',
				placeholder: '2026-09-25',
				description: 'Day to summarise, `Y-m-d` or `Y-m-d H:i` in Asia/Almaty. Empty means today; a future date is refused.',
				displayOptions: {
					show: { resource: ['cashbox'], operation: ['getSummary'] },
				},
			},
			{
				displayName: 'Date From',
				name: 'dateFrom',
				type: 'string',
				default: '',
				required: true,
				placeholder: '2026-09-01',
				description: 'Start of the window, `Y-m-d` or `Y-m-d H:i` in Asia/Almaty',
				displayOptions: {
					show: { resource: ['cashbox'], operation: ['getShifts'] },
				},
			},
			{
				displayName: 'Date To',
				name: 'dateTo',
				type: 'string',
				default: '',
				required: true,
				placeholder: '2026-09-25',
				description: 'End of the window, at or after Date From. A window wider than 31 days is refused.',
				displayOptions: {
					show: { resource: ['cashbox'], operation: ['getShifts'] },
				},
			},
			{
				displayName: 'Shift ID',
				name: 'shiftId',
				type: 'number',
				default: 0,
				required: true,
				description: 'The kaspi_shift_id taken from Get Shifts. A shift you have not listed is reported as not found — that is also what an organisation without a Kaspi cashbox gets.',
				displayOptions: {
					show: { resource: ['cashbox'], operation: ['getReconciliation', 'getShiftReport'] },
				},
			},
			{
				displayName: 'Shift Number',
				name: 'shiftNumber',
				type: 'number',
				default: 0,
				required: true,
				description: 'Kaspi shift number to close',
				displayOptions: {
					show: { resource: ['cashbox'], operation: ['closeShift'] },
				},
			},
			{
				displayName: 'Client Operation ID',
				name: 'clientOperationId',
				type: 'string',
				default: '',
				required: true,
				description: 'Idempotency key, unique per organisation, 8-191 characters of A-Z a-z 0-9 . _ : and -. On 503 the operation was NOT created — retry with the SAME key. ⛔ After a failed operation the key is NOT released: retry the close with a NEW key, otherwise the answer is 409.',
				displayOptions: {
					show: { resource: ['cashbox'], operation: ['closeShift'] },
				},
			},
			{
				displayName: 'Operation ID',
				name: 'operationId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the cashbox operation returned by Close Shift',
				displayOptions: {
					show: { resource: ['cashbox'], operation: ['getOperation'] },
				},
			},
			{
				displayName: 'Enabled',
				name: 'enabled',
				type: 'boolean',
				default: false,
				description: 'Whether the toggle should be on. Idempotent: if the live value in Kaspi already matches, the answer carries changed:false and the cashbox is not touched. ⛔ Writing requires an API key issued by the organisation OWNER; any key of the organisation can read the settings.',
				displayOptions: {
					show: { resource: ['cashbox'], operation: ['setAutoClose', 'setAutoWithdrawal'] },
				},
			},
			{
				displayName: 'Kaspi Connection ID',
				name: 'kaspiConnectionId',
				type: 'number',
				default: 0,
				description: 'Which cashier to act on. Defaults to the primary connection of the organisation.',
				displayOptions: {
					show: {
						resource: ['cashbox'],
						operation: [
							'getSummary',
							'getReconciliation',
							'getShifts',
							'closeShift',
							'setAutoClose',
							'setAutoWithdrawal',
						],
					},
				},
			},

			// ══════════════════════════════════════
			// Fields: Client
			// ══════════════════════════════════════
			{
				displayName: 'Phone Number',
				name: 'phoneNumber',
				type: 'string',
				default: '',
				required: true,
				placeholder: '77001234567',
				description: 'Customer phone number; 77.../87.../+77... with spaces or dashes are all normalised. ⛔ Do not loop this over a list of numbers: bulk enumeration deactivates the API key without warning.',
				displayOptions: {
					show: { resource: ['client'], operation: ['check'] },
				},
			},

			// ══════════════════════════════════════
			// Fields: Webhook Log
			// ══════════════════════════════════════
			{
				displayName: 'Webhook Log ID',
				name: 'webhookLogId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the webhook delivery',
				displayOptions: {
					show: { resource: ['webhookLog'], operation: ['get'] },
				},
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: { resource: ['webhookLog'], operation: ['getAll'] },
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['webhookLog'], operation: ['getAll'], returnAll: [false] },
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: { resource: ['webhookLog'], operation: ['getAll'] },
				},
				options: [
					{
						displayName: 'Date From',
						name: 'dateFrom',
						type: 'string',
						default: '',
						placeholder: '2026-07-13',
						description: 'Lower bound of the delivery date',
					},
					{
						displayName: 'Date To',
						name: 'dateTo',
						type: 'string',
						default: '',
						placeholder: '2026-07-14',
						description: 'Upper bound of the delivery date',
					},
					{
						displayName: 'Event',
						name: 'event',
						type: 'string',
						default: '',
						placeholder: 'invoice.status_changed',
						description: 'Filter by webhook event name',
					},
					{
						displayName: 'Invoice ID',
						name: 'invoiceId',
						type: 'number',
						default: 0,
						description: 'Only deliveries tied to this invoice',
					},
					{
						displayName: 'Sort By',
						name: 'sortBy',
						type: 'options',
						options: [
							{ name: 'Created At', value: 'created_at' },
							{ name: 'Response Status', value: 'response_status' },
							{ name: 'Response Time', value: 'response_time_ms' },
						],
						default: 'created_at',
						description: 'Field to sort deliveries by',
					},
					{
						displayName: 'Sort Order',
						name: 'sortOrder',
						type: 'options',
						options: [
							{ name: 'Ascending', value: 'asc' },
							{ name: 'Descending', value: 'desc' },
						],
						default: 'desc',
						description: 'Sort direction',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Failed', value: 'failed' },
							{ name: 'Success', value: 'success' },
						],
						default: 'success',
						description: 'Filter by delivery outcome',
					},
				],
			},


			// -- Catalog: Bulk Delete --
			{
				displayName: 'Match By',
				name: 'matchBy',
				type: 'options',
				options: [
					{ name: 'Catalog Item IDs', value: 'ids' },
					{ name: 'External Refs', value: 'external_refs' },
				],
				default: 'ids',
				description: 'Targets are given by exactly one list. ⛔ Barcodes are not accepted: a barcode is not unique and one value could take hundreds of positions off sale.',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['bulkDelete'] },
				},
			},
			{
				displayName: 'Values',
				name: 'values',
				type: 'string',
				default: '',
				required: true,
				placeholder: '101,102,103',
				description: 'Comma-separated identifiers, at most 200. ⛔ The integration only takes down ITS OWN positions: anything the merchant or another integration created comes back in not_yours and stays on sale.',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['bulkDelete'] },
				},
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['catalog'], operation: ['bulkDelete'] },
				},
				options: [
					{
						displayName: 'Dry Run',
						name: 'dryRun',
						type: 'boolean',
						default: false,
						description: 'Whether to only count and show a sample without changing anything. Does not spend the idempotency key.',
					},
					{
						displayName: 'Expected Count',
						name: 'expectedCount',
						type: 'number',
						typeOptions: { minValue: 0 },
						default: 0,
						description: 'Cross-check against would_delete from a dry run. A mismatch answers 409 and changes nothing — worth setting before a large removal.',
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						description: 'An exact repeat of the same body answers 200 with idempotent_replay and does not delete again. A different body under the same key answers 409.',
					},
				],
			},

			// -- Catalog: Scan --
			{
				displayName: 'Barcode',
				name: 'barcode',
				type: 'string',
				default: '',
				required: true,
				placeholder: '4607015232646',
				description: 'Barcode to resolve. An empty result is NOT an error: the goods are simply not in the national catalogue, and you create the position the ordinary way without ntin or gtin. One barcode can return several candidates.',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['scan'] },
				},
			},

			// -- Catalog: Get Queue / Get Errors --
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['getQueue', 'getErrors'] },
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['getQueue', 'getErrors'], returnAll: [false] },
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: { resource: ['catalog'], operation: ['getQueue', 'getErrors'] },
				},
				options: [
					{
						displayName: 'From',
						name: 'from',
						type: 'string',
						default: '',
						placeholder: '2026-09-01',
						description: 'Lower bound, errors only',
					},
					{
						displayName: 'Sort Order',
						name: 'sortOrder',
						type: 'options',
						options: [
							{ name: 'Ascending', value: 'asc' },
							{ name: 'Descending', value: 'desc' },
						],
						default: 'desc',
						description: 'Sort direction',
					},
					{
						displayName: 'To',
						name: 'to',
						type: 'string',
						default: '',
						placeholder: '2026-09-25',
						description: 'Upper bound, errors only',
					},
				],
			},

			// -- Catalog: Get Webhook Logs --
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['getWebhookLogs'] },
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['getWebhookLogs'], returnAll: [false] },
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: { resource: ['catalog'], operation: ['getWebhookLogs'] },
				},
				options: [
					{
						displayName: 'Catalog Item Name or ID',
						name: 'catalogItemId',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getCatalogItems' },
						default: 0,
						description: 'Only deliveries for this catalog item. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Created After',
						name: 'createdAfter',
						type: 'string',
						default: '',
						placeholder: '2026-07-13',
						description: 'Only deliveries after this moment. These logs rotate after 3 days — older deliveries are gone, not missing.',
					},
					{
						displayName: 'Sort Order',
						name: 'sortOrder',
						type: 'options',
						options: [
							{ name: 'Ascending', value: 'asc' },
							{ name: 'Descending', value: 'desc' },
						],
						default: 'desc',
						description: 'Sort direction',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Failed', value: 'failed' },
							{ name: 'Success', value: 'success' },
						],
						default: 'success',
						description: 'Filter by delivery outcome',
					},
				],
			},

			// ══════════════════════════════════════
			// Fields: Receipt
			// ══════════════════════════════════════

			// -- Receipt: Issue --
			{
				displayName: 'Payment Type',
				name: 'paymentType',
				type: 'options',
				options: [
					{ name: 'Cash', value: 3 },
					{ name: 'POS of Another Bank', value: 5 },
				],
				default: 3,
				required: true,
				description: 'A fiscal receipt covers payments that did NOT go through Kaspi QR. For a Kaspi payment use Invoice → Get Receipt instead.',
				displayOptions: {
					show: { resource: ['receipt'], operation: ['issue'] },
				},
			},
			{
				displayName: 'Client Operation ID',
				name: 'clientOperationId',
				type: 'string',
				default: '',
				required: true,
				description: 'Idempotency key, unique per organisation. A re-run of the workflow with the same key does not punch a second receipt.',
				displayOptions: {
					show: { resource: ['receipt'], operation: ['issue'] },
				},
			},
			{
				displayName: 'Cart Items',
				name: 'cartItems',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				required: true,
				description: 'Positions from the synced catalog. In production a position must already be synced with Kaspi, otherwise the receipt fails with item_not_fiscal.',
				displayOptions: {
					show: { resource: ['receipt'], operation: ['issue'] },
				},
				options: [
					{
						displayName: 'Item',
						name: 'item',
						values: [
							{
								displayName: 'Catalog Item Name or ID',
								name: 'catalogItemId',
								type: 'options',
								typeOptions: { loadOptionsMethod: 'getCatalogItems' },
								default: 0,
								description: 'ID of the catalog item. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
							},
							{
								displayName: 'Quantity',
								name: 'quantity',
								type: 'number',
								typeOptions: { minValue: 1 },
								default: 1,
								description: 'How many units. Note this route calls the field quantity, not count.',
							},
							{
								displayName: 'Price',
								name: 'price',
								type: 'number',
								default: 0,
								description: 'Price per unit, overriding the catalog selling price (optional)',
							},
						],
					},
				],
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['receipt'], operation: ['issue'] },
				},
				options: [
					{
						displayName: 'Kaspi Connection ID',
						name: 'kaspiConnectionId',
						type: 'number',
						default: 0,
						description: 'Which connected cashier to punch through. Defaults to the primary one.',
					},
					{
						displayName: 'Received Amount',
						name: 'receivedAmt',
						type: 'number',
						default: 0,
						description: 'Cash only: how much the customer handed over, so Kaspi can print the change. Ignored for an outside POS.',
					},
					{
						displayName: 'Simulate Error Code',
						name: 'simulateErrorCode',
						type: 'options',
						options: [
							{ name: 'Item Not Fiscal', value: 'item_not_fiscal' },
							{ name: 'Kaspi Error', value: 'receipt_kaspi_error' },
							{ name: 'Shift Closed', value: 'shift_closed' },
						],
						default: 'receipt_kaspi_error',
						description: 'Sandbox only: which failure to force when Simulate Status is failed',
					},
					{
						displayName: 'Simulate Status',
						name: 'simulateStatus',
						type: 'options',
						options: [
							{ name: 'Failed', value: 'failed' },
							{ name: 'Issued', value: 'issued' },
						],
						default: 'issued',
						description: 'Sandbox only: force the outcome of the receipt. A live organisation answers 403 not_sandbox.',
					},
				],
			},

			// -- Receipt: Preview --
			{
				displayName: 'Payment Type',
				name: 'paymentType',
				type: 'options',
				options: [
					{ name: 'Cash', value: 3 },
					{ name: 'POS of Another Bank', value: 5 },
				],
				default: 3,
				required: true,
				description: 'A fiscal receipt covers payments that did NOT go through Kaspi QR. For a Kaspi payment use Invoice → Get Receipt instead.',
				displayOptions: {
					show: { resource: ['receipt'], operation: ['preview'] },
				},
			},
			{
				displayName: 'Total Price',
				name: 'totalPrice',
				type: 'number',
				default: 0,
				required: true,
				typeOptions: { minValue: 0, numberPrecision: 2 },
				description: 'Receipt total to preview',
				displayOptions: {
					show: { resource: ['receipt'], operation: ['preview'] },
				},
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['receipt'], operation: ['preview'] },
				},
				options: [
					{
						displayName: 'Kaspi Connection ID',
						name: 'kaspiConnectionId',
						type: 'number',
						default: 0,
						description: 'Which connected cashier to preview for. Defaults to the primary one.',
					},
				],
			},

			// -- Receipt: Get --
			{
				displayName: 'Receipt ID',
				name: 'receiptId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the fiscal receipt',
				displayOptions: {
					show: { resource: ['receipt'], operation: ['get'] },
				},
			},

			// -- Receipt: Get Many --
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: { resource: ['receipt'], operation: ['getAll'] },
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['receipt'], operation: ['getAll'], returnAll: [false] },
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: { resource: ['receipt'], operation: ['getAll'] },
				},
				options: [
					{
						displayName: 'From',
						name: 'from',
						type: 'string',
						default: '',
						placeholder: '2026-07-13',
						description: 'Lower bound of created_at. A bare date is read in Asia/Almaty — the merchant calendar day; an explicit offset is taken as given.',
					},
					{
						displayName: 'Invoice ID',
						name: 'invoiceId',
						type: 'number',
						default: 0,
						description: 'Only receipts tied to this invoice',
					},
					{
						displayName: 'Payment Type',
						name: 'paymentType',
						type: 'options',
						options: [
							{ name: 'Cash', value: 3 },
							{ name: 'POS of Another Bank', value: 5 },
						],
						default: 3,
						description: 'Filter by how the customer paid',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Failed', value: 'failed' },
							{ name: 'Issued', value: 'issued' },
							{ name: 'Pending', value: 'pending' },
						],
						default: 'issued',
						description: 'Filter by receipt status',
					},
					{
						displayName: 'To',
						name: 'to',
						type: 'string',
						default: '',
						placeholder: '2026-07-14',
						description: 'Upper bound of created_at, must be at or after From. A bare date covers the whole day in Asia/Almaty.',
					},
				],
			},

			// ══════════════════════════════════════
			// Fields: Static QR
			// ══════════════════════════════════════

			// -- Static QR: Create --
			{
				displayName: 'Amount',
				name: 'amount',
				type: 'number',
				default: 0,
				required: true,
				typeOptions: { minValue: 0, maxValue: 99999999.99, numberPrecision: 2 },
				description: 'Amount of the deal. Leave at 0 when cart items are provided. Use a whole number of tenge if the customer may pay by phone number from the sheet: that fallback rejects tiyn, and a printed sheet cannot be reissued.',
				displayOptions: {
					show: { resource: ['staticQr'], operation: ['create'] },
				},
			},
			{
				displayName: 'Description',
				name: 'description',
				type: 'string',
				default: '',
				description: 'Line name in the Kaspi receipt. Keep it to 60 characters: every sheet also offers payment by phone number, and that route rejects anything longer. It cannot be changed once the sheet is issued.',
				displayOptions: {
					show: { resource: ['staticQr'], operation: ['create'] },
				},
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['staticQr'], operation: ['create'] },
				},
				options: [
					{
						displayName: 'Cart Items',
						name: 'cartItems',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						description: 'Positions from the synced catalog. Required for merchants who have a catalog — such an organisation cannot issue a QR invoice with a bare amount.',
						options: [
							{
								displayName: 'Item',
								name: 'item',
								values: [
									{
										displayName: 'Catalog Item Name or ID',
										name: 'catalogItemId',
										type: 'options',
										typeOptions: { loadOptionsMethod: 'getCatalogItems' },
										default: 0,
										description: 'ID of the catalog item. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
									},
									{
										displayName: 'Count',
										name: 'count',
										type: 'number',
										default: 1,
										description: 'Quantity of the item',
									},
									{
										displayName: 'Price',
										name: 'price',
										type: 'number',
										default: 0,
										description: 'Price for this line, overriding the catalog price (optional)',
									},
								],
							},
						],
					},
					{
						displayName: 'Discount Percentage',
						name: 'discountPercentage',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 99 },
						default: 0,
						description: 'Discount percentage (1-99)',
					},
					{
						displayName: 'Expires At',
						name: 'expiresAt',
						type: 'dateTime',
						default: '',
						description: 'When the deal stops being payable. Must be in the future.',
					},
					{
						displayName: 'External Order ID',
						name: 'externalOrderId',
						type: 'string',
						default: '',
						description: 'Your own order identifier, echoed back in the webhook',
					},
					{
						displayName: 'Kaspi Connection ID',
						name: 'kaspiConnectionId',
						type: 'number',
						default: 0,
						description: 'Which connected cashier the future invoice belongs to. Defaults to the primary one.',
					},
					{
						displayName: 'Single Use',
						name: 'singleUse',
						type: 'boolean',
						default: true,
						description: 'Whether the sheet covers one deal only and locks to "Paid" afterwards',
					},
				],
			},

			// -- Static QR: Get / Disable --
			{
				displayName: 'Static QR ID',
				name: 'staticQrId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the printable QR sheet',
				displayOptions: {
					show: { resource: ['staticQr'], operation: ['get', 'disable'] },
				},
			},

			// -- Static QR: Get Many --
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: { resource: ['staticQr'], operation: ['getAll'] },
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1 },
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['staticQr'], operation: ['getAll'], returnAll: [false] },
				},
			},

			// -- Invoice: Get --
			{
				displayName: 'Invoice ID',
				name: 'invoiceId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the invoice',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['get'] },
				},
			},

			// -- Invoice: Get Many --
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['getAll'] },
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 100 },
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['getAll'], returnAll: [false] },
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: { resource: ['invoice'], operation: ['getAll'] },
				},
				options: [
					{
						displayName: 'Date Field',
						name: 'dateField',
						type: 'options',
						options: [
							{ name: 'Created At', value: 'created_at' },
							{ name: 'Paid At', value: 'paid_at' },
						],
						default: 'created_at',
						description: 'Which date the window applies to. Reconciling a cash day needs paid_at: an invoice issued yesterday and paid today belongs to today.',
					},
					{
						displayName: 'Date From',
						name: 'dateFrom',
						type: 'dateTime',
						default: '',
						description: 'Filter invoices created after this date',
					},
					{
						displayName: 'Date To',
						name: 'dateTo',
						type: 'dateTime',
						default: '',
						description: 'Filter invoices created before this date',
					},
					{
						displayName: 'Origin',
						name: 'origin',
						type: 'options',
						options: [
							{ name: 'All', value: 'all' },
							{ name: 'ApiPay', value: 'apipay' },
							{ name: 'Kaspi', value: 'kaspi' },
						],
						default: 'all',
						description: 'Whether to include invoices that came from the Kaspi history sync rather than from ApiPay',
					},
					{
						displayName: 'Search',
						name: 'search',
						type: 'string',
						default: '',
						description: 'Search term to filter invoices',
					},
					{
						displayName: 'Sort By',
						name: 'sortBy',
						type: 'options',
						options: [
							{ name: 'Created At', value: 'created_at' },
							{ name: 'Amount', value: 'amount' },
							{ name: 'Status', value: 'status' },
						],
						default: 'created_at',
						description: 'Field to sort by',
					},
					{
						displayName: 'Sort Order',
						name: 'sortOrder',
						type: 'options',
						options: [
							{ name: 'Ascending', value: 'asc' },
							{ name: 'Descending', value: 'desc' },
						],
						default: 'desc',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'multiOptions',
						options: [
							{ name: 'Cancelled', value: 'cancelled' },
							{ name: 'Cancelling', value: 'cancelling' },
							{ name: 'Expired', value: 'expired' },
							{ name: 'Paid', value: 'paid' },
							{ name: 'Partially Refunded', value: 'partially_refunded' },
							{ name: 'Pending', value: 'pending' },
							{ name: 'Processing', value: 'processing' },
							{ name: 'Refunded', value: 'refunded' },
						],
						default: [],
						description: 'Filter by invoice status. ⚠️ A filter for "paid" alone is incomplete for reconciliation: an invoice with a partial refund did take the money and sits in partially_refunded. Processing is the freshly created state before Kaspi answered.',
					},
				],
			},

			// -- Invoice: Cancel --
			{
				displayName: 'Invoice ID',
				name: 'invoiceId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the invoice to cancel',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['cancel'] },
				},
			},

			// -- Invoice: Check Status --
			{
				displayName: 'Invoice IDs',
				name: 'invoiceIds',
				type: 'string',
				default: '',
				required: true,
				placeholder: '1,2,3',
				description: 'Comma-separated invoice IDs to check (max 100)',
				displayOptions: {
					show: { resource: ['invoice'], operation: ['checkStatus'] },
				},
			},

			// ══════════════════════════════════════
			// Fields: Refund
			// ══════════════════════════════════════

			// -- Refund: Create --
			{
				displayName: 'Invoice ID',
				name: 'invoiceId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the invoice to refund',
				displayOptions: {
					show: { resource: ['refund'], operation: ['create'] },
				},
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['refund'], operation: ['create'] },
				},
				options: [
					{
						displayName: 'Amount',
						name: 'amount',
						type: 'number',
						default: 0,
						description: 'Refund amount. Leave empty for full refund.',
					},
					{
						displayName: 'Reason',
						name: 'reason',
						type: 'string',
						default: '',
						description: 'Reason for the refund (max 500 characters)',
					},
					{
						displayName: 'Return Items',
						name: 'returnItems',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						options: [
							{
								displayName: 'Item',
								name: 'item',
								values: [
									{
										displayName: 'Catalog Item Name or ID',
										name: 'catalogItemId',
										type: 'options',
										typeOptions: { loadOptionsMethod: 'getCatalogItems' },
										default: 0,
										description: 'ID of the catalog item to return. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
									},
									{
										displayName: 'Count',
										name: 'count',
										type: 'number',
										default: 1,
										description: 'Quantity to return',
									},
								],
							},
						],
					},
				],
			},

			// -- Refund: Get --
			{
				displayName: 'Refund ID',
				name: 'refundId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the refund',
				displayOptions: {
					show: { resource: ['refund'], operation: ['get'] },
				},
			},

			// -- Refund: Get Many --
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: { resource: ['refund'], operation: ['getAll'] },
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 100 },
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['refund'], operation: ['getAll'], returnAll: [false] },
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: { resource: ['refund'], operation: ['getAll'] },
				},
				options: [
					{
						displayName: 'Date From',
						name: 'dateFrom',
						type: 'dateTime',
						default: '',
						description: 'Filter refunds created after this date',
					},
					{
						displayName: 'Date To',
						name: 'dateTo',
						type: 'dateTime',
						default: '',
						description: 'Filter refunds created before this date',
					},
					{
						displayName: 'Invoice ID',
						name: 'invoiceId',
						type: 'number',
						default: 0,
						description: 'Filter by invoice ID',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'multiOptions',
						options: [
							{ name: 'Completed', value: 'completed' },
							{ name: 'Failed', value: 'failed' },
							{ name: 'Pending', value: 'pending' },
							{ name: 'Processing', value: 'processing' },
						],
						default: [],
						description: 'Filter by refund status',
					},
				],
			},

			// -- Refund: Get by Invoice --
			{
				displayName: 'Invoice ID',
				name: 'invoiceId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the invoice to get refunds for',
				displayOptions: {
					show: { resource: ['refund'], operation: ['getByInvoice'] },
				},
			},

			// ══════════════════════════════════════
			// Fields: Subscription
			// ══════════════════════════════════════

			// -- Subscription: Create --
			{
				displayName: 'Phone Number',
				name: 'phoneNumber',
				type: 'string',
				default: '',
				required: true,
				placeholder: '87001234567',
				description: 'Subscriber phone number in format 8XXXXXXXXXX',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['create'] },
				},
			},
			{
				displayName: 'Billing Period',
				name: 'billingPeriod',
				type: 'options',
				required: true,
				options: [
					{ name: 'Biweekly', value: 'biweekly' },
					{ name: 'Daily', value: 'daily' },
					{ name: 'Monthly', value: 'monthly' },
					{ name: 'Quarterly', value: 'quarterly' },
					{ name: 'Weekly', value: 'weekly' },
					{ name: 'Yearly', value: 'yearly' },
				],
				default: 'monthly',
				description: 'Billing period for the subscription',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['create'] },
				},
			},
			{
				displayName: 'Amount',
				name: 'amount',
				type: 'number',
				default: 0,
				required: true,
				typeOptions: { minValue: 100, maxValue: 1000000, numberPrecision: 2 },
				description: 'Subscription amount (100-1000000). Required if no cart items provided.',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['create'] },
				},
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['subscription'], operation: ['create'] },
				},
				options: [
					{
						displayName: 'Billing Day',
						name: 'billingDay',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 28 },
						default: 1,
						description: 'Billing day. For monthly, quarterly and yearly — day of the month, 1-28. For weekly and biweekly — day of the WEEK, 1 = Monday through 7 = Sunday, and a larger value is rejected on those periods. Not used for daily.',
					},
					{
						displayName: 'Cart Items',
						name: 'cartItems',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						options: [
							{
								displayName: 'Item',
								name: 'item',
								values: [
									{
										displayName: 'Catalog Item Name or ID',
										name: 'catalogItemId',
										type: 'options',
										typeOptions: { loadOptionsMethod: 'getCatalogItems' },
										default: 0,
										description: 'ID of the catalog item. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
									},
									{
										displayName: 'Count',
										name: 'count',
										type: 'number',
										default: 1,
										description: 'Quantity of the item',
									},
									{
										displayName: 'Price',
										name: 'price',
										type: 'number',
										default: 0,
										description: 'Custom price for the item (optional)',
									},
								],
							},
						],
					},
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: '',
						description: 'Subscription description',
					},
					{
						displayName: 'External Subscriber ID',
						name: 'externalSubscriberId',
						type: 'string',
						default: '',
						description: 'Your external subscriber identifier',
					},
					{
						displayName: 'Grace Period Days',
						name: 'gracePeriodDays',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 30 },
						default: 3,
						description: 'Grace period in days before subscription expires (1-30)',
					},
					{
						displayName: 'Max Retry Attempts',
						name: 'maxRetryAttempts',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 10 },
						default: 3,
						description: 'Maximum retry attempts for failed payments (1-10)',
					},
					{
						displayName: 'Metadata',
						name: 'metadata',
						type: 'json',
						default: '{}',
						description: 'Additional metadata as JSON object',
					},
					{
						displayName: 'Retry Interval Hours',
						name: 'retryIntervalHours',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 168 },
						default: 24,
						description: 'Hours between retry attempts (1-168)',
					},
					{
						displayName: 'Started At',
						name: 'startedAt',
						type: 'dateTime',
						default: '',
						description: 'Subscription start date (will be sent as YYYY-MM-DD)',
					},
					{
						displayName: 'Subscriber Name',
						name: 'subscriberName',
						type: 'string',
						default: '',
						description: 'Name of the subscriber',
					},
					{
						displayName: 'Webhook ID',
						name: 'webhookId',
						type: 'number',
						default: 0,
						description: 'ID of the webhook to use for notifications',
					},
				],
			},

			// -- Subscription: Get / Pause / Resume / Cancel --
			{
				displayName: 'Subscription ID',
				name: 'subscriptionId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the subscription',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['get'] },
				},
			},
			{
				displayName: 'Subscription ID',
				name: 'subscriptionId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the subscription to pause',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['pause'] },
				},
			},
			{
				displayName: 'Subscription ID',
				name: 'subscriptionId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the subscription to resume',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['resume'] },
				},
			},
			{
				displayName: 'Subscription ID',
				name: 'subscriptionId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the subscription to cancel',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['cancel'] },
				},
			},

			// -- Subscription: Get Many --
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['getAll'] },
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 100 },
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['getAll'], returnAll: [false] },
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: { resource: ['subscription'], operation: ['getAll'] },
				},
				options: [
					{
						displayName: 'Billing Period',
						name: 'billingPeriod',
						type: 'options',
						options: [
							{ name: 'Biweekly', value: 'biweekly' },
							{ name: 'Daily', value: 'daily' },
							{ name: 'Monthly', value: 'monthly' },
							{ name: 'Quarterly', value: 'quarterly' },
							{ name: 'Weekly', value: 'weekly' },
							{ name: 'Yearly', value: 'yearly' },
						],
						default: 'monthly',
						description: 'Filter by billing period',
					},
					{
						displayName: 'External Subscriber ID',
						name: 'externalSubscriberId',
						type: 'string',
						default: '',
						description: 'Filter by external subscriber ID',
					},
					{
						displayName: 'Phone Number',
						name: 'phoneNumber',
						type: 'string',
						default: '',
						description: 'Filter by phone number',
					},
					{
						displayName: 'Search',
						name: 'search',
						type: 'string',
						default: '',
						description: 'Search term to filter subscriptions',
					},
					{
						displayName: 'Sort By',
						name: 'sortBy',
						type: 'options',
						options: [
							{ name: 'Created At', value: 'created_at' },
							{ name: 'Amount', value: 'amount' },
							{ name: 'Status', value: 'status' },
						],
						default: 'created_at',
						description: 'Field to sort by',
					},
					{
						displayName: 'Sort Order',
						name: 'sortOrder',
						type: 'options',
						options: [
							{ name: 'Ascending', value: 'asc' },
							{ name: 'Descending', value: 'desc' },
						],
						default: 'desc',
					},
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						options: [
							{ name: 'Active', value: 'active' },
							{ name: 'Cancelled', value: 'cancelled' },
							{ name: 'Expired', value: 'expired' },
							{ name: 'Paused', value: 'paused' },
						],
						default: 'active',
						description: 'Filter by subscription status',
					},
				],
			},

			// -- Subscription: Update --
			{
				displayName: 'Subscription ID',
				name: 'subscriptionId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the subscription to update',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['update'] },
				},
			},
			{
				displayName: 'Update Fields',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['subscription'], operation: ['update'] },
				},
				options: [
					{
						displayName: 'Amount',
						name: 'amount',
						type: 'number',
						typeOptions: { minValue: 100, maxValue: 1000000, numberPrecision: 2 },
						default: 0,
						description: 'New subscription amount',
					},
					{
						displayName: 'Billing Day',
						name: 'billingDay',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 28 },
						default: 1,
						description: 'New billing day (1-28)',
					},
					{
						displayName: 'Cart Items',
						name: 'cartItems',
						type: 'fixedCollection',
						typeOptions: { multipleValues: true },
						default: {},
						options: [
							{
								displayName: 'Item',
								name: 'item',
								values: [
									{
										displayName: 'Catalog Item Name or ID',
										name: 'catalogItemId',
										type: 'options',
										typeOptions: { loadOptionsMethod: 'getCatalogItems' },
										default: 0,
										description: 'ID of the catalog item. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
									},
									{
										displayName: 'Count',
										name: 'count',
										type: 'number',
										default: 1,
										description: 'Quantity of the item',
									},
									{
										displayName: 'Price',
										name: 'price',
										type: 'number',
										default: 0,
										description: 'Custom price for the item (optional)',
									},
								],
							},
						],
					},
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: '',
						description: 'New subscription description',
					},
					{
						displayName: 'Metadata',
						name: 'metadata',
						type: 'json',
						default: '{}',
						description: 'New metadata as JSON object',
					},
					{
						displayName: 'Subscriber Name',
						name: 'subscriberName',
						type: 'string',
						default: '',
						description: 'New subscriber name',
					},
				],
			},

			// -- Subscription: Get Invoices --
			{
				displayName: 'Subscription ID',
				name: 'subscriptionId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the subscription to get invoices for',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['getInvoices'] },
				},
			},


			// -- Subscription: simulations (sandbox only) --
			{
				displayName: 'Subscription ID',
				name: 'subscriptionId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the sandbox subscription. A live organisation is refused with not_sandbox.',
				displayOptions: {
					show: {
						resource: ['subscription'],
						operation: ['simulateInvoice', 'startSimulation', 'stopSimulation'],
					},
				},
			},
			{
				displayName: 'Interval Minutes',
				name: 'intervalMinutes',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 60 },
				default: 5,
				required: true,
				description: 'How often to generate an invoice, 1-60 minutes. At most three simulations run at once per organisation.',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['startSimulation'] },
				},
			},
			{
				displayName: 'Max Invoices',
				name: 'maxInvoices',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 20 },
				default: 5,
				description: 'How many invoices to generate before stopping, 1-20',
				displayOptions: {
					show: { resource: ['subscription'], operation: ['startSimulation'] },
				},
			},

			// ══════════════════════════════════════
			// Fields: Catalog
			// ══════════════════════════════════════

			// -- Catalog: Get Many --
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['getAll'] },
				},
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 200 },
				description: 'Max number of results to return',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['getAll'], returnAll: [false] },
				},
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: {
					show: { resource: ['catalog'], operation: ['getAll'] },
				},
				options: [
					{
						displayName: 'Barcode',
						name: 'barcode',
						type: 'string',
						default: '',
						description: 'Filter by barcode',
					},
					{
						displayName: 'First Character',
						name: 'firstChar',
						type: 'string',
						default: '',
						description: 'Filter by first character of item name',
					},
					{
						displayName: 'Search',
						name: 'search',
						type: 'string',
						default: '',
						description: 'Search term to filter catalog items',
					},
				],
			},

			// -- Catalog: Create --
			{
				displayName: 'Items',
				name: 'items',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				required: true,
				default: {},
				description: 'Catalog items to create (max 100)',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['create'] },
				},
				options: [
					{
						displayName: 'Item',
						name: 'item',
						values: [
							{
								displayName: 'Barcode',
								name: 'barcode',
								type: 'string',
								default: '',
								description: 'Barcode of the item (optional)',
							},
							{
								displayName: 'Image ID',
								name: 'imageId',
								type: 'number',
								default: 0,
								description: 'Image ID from Upload Image operation (optional)',
							},
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								required: true,
								description: 'Item name',
							},
							{
								displayName: 'Selling Price',
								name: 'sellingPrice',
								type: 'number',
								default: 0,
								required: true,
								description: 'Selling price of the item',
							},
							{
								displayName: 'Unit Name or ID',
								name: 'unitId',
								type: 'options',
								typeOptions: { loadOptionsMethod: 'getUnits' },
								default: 0,
								required: true,
								description: 'Unit of measurement ID (use Get Units to find available units). Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
							},
						],
					},
				],
			},

			// -- Catalog: Upload Image --
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property containing the image file',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['uploadImage'] },
				},
			},

			// -- Catalog: Update --
			{
				displayName: 'Item ID',
				name: 'itemId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the catalog item to update',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['update'] },
				},
			},
			{
				displayName: 'Update Fields',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: {
					show: { resource: ['catalog'], operation: ['update'] },
				},
				options: [
					{
						displayName: 'Barcode',
						name: 'barcode',
						type: 'string',
						default: '',
						description: 'New barcode',
					},
					{
						displayName: 'Delete Image',
						name: 'isImageDeleted',
						type: 'boolean',
						default: false,
						description: 'Whether to delete the current image',
					},
					{
						displayName: 'Image ID',
						name: 'imageId',
						type: 'number',
						default: 0,
						description: 'New image ID',
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description: 'New item name',
					},
					{
						displayName: 'Selling Price',
						name: 'sellingPrice',
						type: 'number',
						default: 0,
						description: 'New selling price',
					},
					{
						displayName: 'Unit Name or ID',
						name: 'unitId',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getUnits' },
						default: 0,
						description: 'New unit of measurement ID. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
				],
			},

			// -- Catalog: Delete --
			{
				displayName: 'Item ID',
				name: 'itemId',
				type: 'number',
				default: 0,
				required: true,
				description: 'ID of the catalog item to delete',
				displayOptions: {
					show: { resource: ['catalog'], operation: ['delete'] },
				},
			},
		],
	};

	methods = {
		loadOptions: {
			/** Units are a short closed list, so the whole thing fits in a dropdown. */
			async getUnits(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await loadOptionsRequest.call(this, '/catalog/units');
				const units = (response.data as IDataObject[]) || [];
				return units.map((unit) => ({
					name: String(unit.name ?? unit.id),
					value: unit.id as number,
				}));
			},

			/**
			 * Catalog positions, newest first, capped at 200.
			 *
			 * A dropdown cannot paginate, and a large catalog would not fit. That is not a dead
			 * end: an options field still accepts an expression, so a workflow over a bigger
			 * catalog sets the numeric id directly. Said so in the field description.
			 */
			async getCatalogItems(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await loadOptionsRequest.call(this, '/catalog', { page: 1, per_page: 200 });
				const items = (response.data as IDataObject[]) || [];
				return items.map((item) => {
					const price = item.selling_price ?? item.price;
					return {
						name: price ? `${String(item.name)} — ${String(price)}` : String(item.name),
						value: item.id as number,
					};
				});
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				let responseData: IDataObject | IDataObject[];

				// ════════════════════════════════════
				// Invoice
				// ════════════════════════════════════
				if (resource === 'invoice') {
					if (operation === 'create') {
						const amount = this.getNodeParameter('amount', i) as number;
						const body: IDataObject = {
							phone_number: this.getNodeParameter('phoneNumber', i) as string,
						};
						// An invoice built from cart items has its total computed server-side;
						// sending amount: 0 alongside a cart is rejected with 422.
						if (amount > 0) {
							body.amount = amount;
						}
						const description = this.getNodeParameter('description', i) as string;
						if (description) {
							body.description = description;
						}
						const externalOrderId = this.getNodeParameter('externalOrderId', i) as string;
						if (externalOrderId) {
							body.external_order_id = externalOrderId;
						}
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						if (additionalFields.discountPercentage) {
							body.discount_percentage = additionalFields.discountPercentage;
						}
						if (additionalFields.internalComment) {
							body.internal_comment = additionalFields.internalComment;
						}
						if (additionalFields.externalOrderIdIdempotency) {
							body.external_order_id_idempotency = additionalFields.externalOrderIdIdempotency;
						}
						if (additionalFields.kaspiConnectionId) {
							body.kaspi_connection_id = additionalFields.kaspiConnectionId;
						}
						const cartItems = cartItemsFrom(additionalFields);
						if (cartItems) {
							body.cart_items = cartItems;
						}
						responseData = await apiRequest.call(this, 'POST', '/invoices', body) as IDataObject;
					} else if (operation === 'createQr') {
						// The QR route accepts tiyn, unlike the phone route. Everything else that
						// matters here is idempotency: without a key a re-run issues a second QR.
						const amount = this.getNodeParameter('amount', i) as number;
						const description = this.getNodeParameter('description', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						const body: IDataObject = {};
						if (amount > 0) {
							body.amount = amount;
						}
						if (description) {
							body.description = description;
						}
						if (additionalFields.internalComment) {
							body.internal_comment = additionalFields.internalComment;
						}
						if (additionalFields.externalOrderId) {
							body.external_order_id = additionalFields.externalOrderId;
						}
						if (additionalFields.externalOrderIdIdempotency) {
							body.external_order_id_idempotency = additionalFields.externalOrderIdIdempotency;
						}
						if (additionalFields.kaspiConnectionId) {
							body.kaspi_connection_id = additionalFields.kaspiConnectionId;
						}
						if (additionalFields.discountPercentage) {
							body.discount_percentage = additionalFields.discountPercentage;
						}
						if (additionalFields.simulate) {
							body.simulate = additionalFields.simulate;
						}
						const qrCartItems = cartItemsFrom(additionalFields);
						if (qrCartItems) {
							body.cart_items = qrCartItems;
						}
						responseData = await apiRequest.call(this, 'POST', '/invoices/qr', body) as IDataObject;
					} else if (operation === 'get') {
						const invoiceId = this.getNodeParameter('invoiceId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/invoices/${invoiceId}`) as IDataObject;
					} else if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						const qs: IDataObject = {};
						if (filters.status && (filters.status as string[]).length > 0) {
							qs['status[]'] = filters.status;
						}
						if (filters.dateFrom) {
							qs.date_from = filters.dateFrom;
						}
						if (filters.dateTo) {
							qs.date_to = filters.dateTo;
						}
						if (filters.search) {
							qs.search = filters.search;
						}
						if (filters.sortBy) {
							qs.sort_by = filters.sortBy;
						}
						if (filters.sortOrder) {
							qs.sort_order = filters.sortOrder;
						}
						if (filters.dateField) {
							qs.date_field = filters.dateField;
						}
						if (filters.origin) {
							qs.origin = filters.origin;
						}

						if (returnAll) {
							const allData: IDataObject[] = [];
							let page = 1;
							let hasMore = true;
							while (hasMore) {
								const response = await apiRequest.call(this, 'GET', '/invoices', {}, { ...qs, page, per_page: 100 }) as IDataObject;
								const data = (response.data || response) as IDataObject[];
								allData.push(...data);
								hasMore = Array.isArray(data) && data.length === 100;
								page++;
							}
							responseData = allData;
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							const response = await apiRequest.call(this, 'GET', '/invoices', {}, { ...qs, page: 1, per_page: limit }) as IDataObject;
							responseData = (response.data || response) as IDataObject[];
						}
					} else if (operation === 'cancel') {
						const invoiceId = this.getNodeParameter('invoiceId', i) as number;
						responseData = await apiRequest.call(this, 'POST', `/invoices/${invoiceId}/cancel`) as IDataObject;
					} else if (operation === 'createBulk') {
						const lines = ((this.getNodeParameter('invoices', i) as IDataObject).invoice as IDataObject[]) || [];
						const cashierId = this.getNodeParameter('kaspiConnectionId', i) as number;
						const body: IDataObject = {
							invoices: lines.map((line) => {
								const entry: IDataObject = { phone_number: line.phoneNumber };
								// Same rule as the single invoice: a zero amount is a 422, and a line
								// built from a cart has its total computed server-side.
								if (line.amount) {
									entry.amount = line.amount;
								}
								if (line.description) {
									entry.description = line.description;
								}
								if (line.externalOrderId) {
									entry.external_order_id = line.externalOrderId;
								}
								if (line.externalOrderIdIdempotency) {
									entry.external_order_id_idempotency = line.externalOrderIdIdempotency;
								}
								if (line.internalComment) {
									entry.internal_comment = line.internalComment;
								}
								return entry;
							}),
						};
						if (cashierId) {
							body.kaspi_connection_id = cashierId;
						}
						responseData = await apiRequest.call(this, 'POST', '/invoices/bulk', body) as IDataObject;
					} else if (operation === 'getStats') {
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						const qs: IDataObject = {};
						if (filters.period) {
							qs.period = filters.period;
						}
						if (filters.startDate) {
							qs.start_date = filters.startDate;
						}
						if (filters.endDate) {
							qs.end_date = filters.endDate;
						}
						if (filters.search) {
							qs.search = filters.search;
						}
						if (filters.dateField) {
							qs.date_field = filters.dateField;
						}
						if (filters.origin) {
							qs.origin = filters.origin;
						}
						responseData = await apiRequest.call(this, 'GET', '/invoices/stats', {}, qs) as IDataObject;
					} else if (operation === 'updateNote') {
						const invoiceId = this.getNodeParameter('invoiceId', i) as number;
						// The key must be present even when empty: a body without it is a 422, and
						// an empty value is how the note gets erased.
						const internalComment = this.getNodeParameter('internalComment', i) as string;
						responseData = await apiRequest.call(this, 'PATCH', `/invoices/${invoiceId}`, {
							internal_comment: internalComment === '' ? null : internalComment,
						}) as IDataObject;
					} else if (operation === 'simulateStatus') {
						const invoiceId = this.getNodeParameter('invoiceId', i) as number;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						const body: IDataObject = { status: this.getNodeParameter('status', i) as string };
						if (additionalFields.kaspiSourceType) {
							body.kaspi_source_type = additionalFields.kaspiSourceType;
						}
						if (additionalFields.kaspiSaleType) {
							body.kaspi_sale_type = additionalFields.kaspiSaleType;
						}
						if (additionalFields.errorMessage) {
							body.error_message = additionalFields.errorMessage;
						}
						responseData = await apiRequest.call(this, 'POST', `/invoices/${invoiceId}/simulate-status`, body) as IDataObject;
					} else if (operation === 'getReceipt') {
						// Asynchronous on purpose: the first call answers 202 with
						// {status: "pending", poll_after}. The body says which it is, so it is
						// passed through as is — a workflow must branch on `status`, not assume
						// the links are there.
						const invoiceId = this.getNodeParameter('invoiceId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/invoices/${invoiceId}/receipt`) as IDataObject;
					} else if (operation === 'checkStatus') {
						const invoiceIdsStr = this.getNodeParameter('invoiceIds', i) as string;
						const invoiceIds = invoiceIdsStr.split(',').map((id) => Number(id.trim()));
						responseData = await apiRequest.call(this, 'POST', '/invoices/status/check', { invoice_ids: invoiceIds }) as IDataObject;
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				}

				// ════════════════════════════════════
				// Refund
				// ════════════════════════════════════
				else if (resource === 'refund') {
					if (operation === 'create') {
						const invoiceId = this.getNodeParameter('invoiceId', i) as number;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						const body: IDataObject = {};
						if (additionalFields.amount) {
							body.amount = additionalFields.amount;
						}
						if (additionalFields.reason) {
							body.reason = additionalFields.reason;
						}
						if (additionalFields.returnItems) {
							const returnItemsData = additionalFields.returnItems as IDataObject;
							const returnItemsList = (returnItemsData.item as IDataObject[]) || [];
							if (returnItemsList.length > 0) {
								body.return_items = returnItemsList.map((item) => ({
									catalog_item_id: item.catalogItemId,
									count: item.count,
								}));
							}
						}
						responseData = await apiRequest.call(this, 'POST', `/invoices/${invoiceId}/refund`, body) as IDataObject;
					} else if (operation === 'get') {
						const refundId = this.getNodeParameter('refundId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/refunds/${refundId}`) as IDataObject;
					} else if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						const qs: IDataObject = {};
						if (filters.status && (filters.status as string[]).length > 0) {
							qs['status[]'] = filters.status;
						}
						if (filters.invoiceId) {
							qs.invoice_id = filters.invoiceId;
						}
						if (filters.dateFrom) {
							qs.date_from = filters.dateFrom;
						}
						if (filters.dateTo) {
							qs.date_to = filters.dateTo;
						}

						if (returnAll) {
							const allData: IDataObject[] = [];
							let page = 1;
							let hasMore = true;
							while (hasMore) {
								const response = await apiRequest.call(this, 'GET', '/refunds', {}, { ...qs, page, per_page: 100 }) as IDataObject;
								const data = (response.data || response) as IDataObject[];
								allData.push(...data);
								hasMore = Array.isArray(data) && data.length === 100;
								page++;
							}
							responseData = allData;
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							const response = await apiRequest.call(this, 'GET', '/refunds', {}, { ...qs, page: 1, per_page: limit }) as IDataObject;
							responseData = (response.data || response) as IDataObject[];
						}
					} else if (operation === 'getByInvoice') {
						const invoiceId = this.getNodeParameter('invoiceId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/invoices/${invoiceId}/refunds`) as IDataObject;
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				}

				// ════════════════════════════════════
				// Subscription
				// ════════════════════════════════════
				else if (resource === 'subscription') {
					if (operation === 'create') {
						const body: IDataObject = {
							phone_number: this.getNodeParameter('phoneNumber', i) as string,
							billing_period: this.getNodeParameter('billingPeriod', i) as string,
							amount: this.getNodeParameter('amount', i) as number,
						};
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						if (additionalFields.billingDay) {
							body.billing_day = additionalFields.billingDay;
						}
						if (additionalFields.description) {
							body.description = additionalFields.description;
						}
						if (additionalFields.subscriberName) {
							body.subscriber_name = additionalFields.subscriberName;
						}
						if (additionalFields.externalSubscriberId) {
							body.external_subscriber_id = additionalFields.externalSubscriberId;
						}
						if (additionalFields.startedAt) {
							const dateValue = additionalFields.startedAt as string;
							body.started_at = dateValue.substring(0, 10);
						}
						if (additionalFields.maxRetryAttempts) {
							body.max_retry_attempts = additionalFields.maxRetryAttempts;
						}
						if (additionalFields.retryIntervalHours) {
							body.retry_interval_hours = additionalFields.retryIntervalHours;
						}
						if (additionalFields.gracePeriodDays) {
							body.grace_period_days = additionalFields.gracePeriodDays;
						}
						if (additionalFields.metadata) {
							body.metadata = typeof additionalFields.metadata === 'string'
								? JSON.parse(additionalFields.metadata)
								: additionalFields.metadata;
						}
						if (additionalFields.webhookId) {
							body.webhook_id = additionalFields.webhookId;
						}
						if (additionalFields.cartItems) {
							const cartItemsData = additionalFields.cartItems as IDataObject;
							const cartItemsList = (cartItemsData.item as IDataObject[]) || [];
							if (cartItemsList.length > 0) {
								body.cart_items = cartItemsList.map((item) => ({
									catalog_item_id: item.catalogItemId,
									count: item.count,
									...(item.price ? { price: item.price } : {}),
								}));
							}
						}
						responseData = await apiRequest.call(this, 'POST', '/subscriptions', body) as IDataObject;
					} else if (operation === 'get') {
						const subscriptionId = this.getNodeParameter('subscriptionId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/subscriptions/${subscriptionId}`) as IDataObject;
					} else if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						const qs: IDataObject = {};
						if (filters.status) {
							qs.status = filters.status;
						}
						if (filters.phoneNumber) {
							qs.phone_number = filters.phoneNumber;
						}
						if (filters.externalSubscriberId) {
							qs.external_subscriber_id = filters.externalSubscriberId;
						}
						if (filters.search) {
							qs.search = filters.search;
						}
						if (filters.billingPeriod) {
							qs.billing_period = filters.billingPeriod;
						}
						if (filters.sortBy) {
							qs.sort_by = filters.sortBy;
						}
						if (filters.sortOrder) {
							qs.sort_order = filters.sortOrder;
						}

						if (returnAll) {
							const allData: IDataObject[] = [];
							let page = 1;
							let hasMore = true;
							while (hasMore) {
								const response = await apiRequest.call(this, 'GET', '/subscriptions', {}, { ...qs, page, per_page: 100 }) as IDataObject;
								const data = (response.data || response) as IDataObject[];
								allData.push(...data);
								hasMore = Array.isArray(data) && data.length === 100;
								page++;
							}
							responseData = allData;
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							const response = await apiRequest.call(this, 'GET', '/subscriptions', {}, { ...qs, page: 1, per_page: limit }) as IDataObject;
							responseData = (response.data || response) as IDataObject[];
						}
					} else if (operation === 'update') {
						const subscriptionId = this.getNodeParameter('subscriptionId', i) as number;
						const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;
						const body: IDataObject = {};
						if (updateFields.amount) {
							body.amount = updateFields.amount;
						}
						if (updateFields.billingDay) {
							body.billing_day = updateFields.billingDay;
						}
						if (updateFields.description) {
							body.description = updateFields.description;
						}
						if (updateFields.subscriberName) {
							body.subscriber_name = updateFields.subscriberName;
						}
						if (updateFields.metadata) {
							body.metadata = typeof updateFields.metadata === 'string'
								? JSON.parse(updateFields.metadata)
								: updateFields.metadata;
						}
						if (updateFields.cartItems) {
							const cartItemsData = updateFields.cartItems as IDataObject;
							const cartItemsList = (cartItemsData.item as IDataObject[]) || [];
							if (cartItemsList.length > 0) {
								body.cart_items = cartItemsList.map((item) => ({
									catalog_item_id: item.catalogItemId,
									count: item.count,
									...(item.price ? { price: item.price } : {}),
								}));
							}
						}
						responseData = await apiRequest.call(this, 'PUT', `/subscriptions/${subscriptionId}`, body) as IDataObject;
					} else if (operation === 'pause') {
						const subscriptionId = this.getNodeParameter('subscriptionId', i) as number;
						responseData = await apiRequest.call(this, 'POST', `/subscriptions/${subscriptionId}/pause`) as IDataObject;
					} else if (operation === 'resume') {
						const subscriptionId = this.getNodeParameter('subscriptionId', i) as number;
						responseData = await apiRequest.call(this, 'POST', `/subscriptions/${subscriptionId}/resume`) as IDataObject;
					} else if (operation === 'cancel') {
						const subscriptionId = this.getNodeParameter('subscriptionId', i) as number;
						responseData = await apiRequest.call(this, 'POST', `/subscriptions/${subscriptionId}/cancel`) as IDataObject;
					} else if (operation === 'simulateInvoice') {
						// Sandbox only, 30-second cooldown. For a subscription with a cart the sum is
						// computed the same way a live charge is — from current catalog prices, not
						// from the stored amount — so a re-priced position changes it.
						const subscriptionId = this.getNodeParameter('subscriptionId', i) as number;
						responseData = await apiRequest.call(this, 'POST', `/subscriptions/${subscriptionId}/simulate-invoice`) as IDataObject;
					} else if (operation === 'startSimulation') {
						const subscriptionId = this.getNodeParameter('subscriptionId', i) as number;
						responseData = await apiRequest.call(this, 'POST', `/subscriptions/${subscriptionId}/start-simulation`, {
							interval_minutes: this.getNodeParameter('intervalMinutes', i) as number,
							max_invoices: this.getNodeParameter('maxInvoices', i) as number,
						}) as IDataObject;
					} else if (operation === 'stopSimulation') {
						const subscriptionId = this.getNodeParameter('subscriptionId', i) as number;
						responseData = await apiRequest.call(this, 'POST', `/subscriptions/${subscriptionId}/stop-simulation`) as IDataObject;
					} else if (operation === 'getInvoices') {
						const subscriptionId = this.getNodeParameter('subscriptionId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/subscriptions/${subscriptionId}/invoices`) as IDataObject;
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				}

				// ════════════════════════════════════
				// Catalog
				// ════════════════════════════════════
				else if (resource === 'catalog') {
					if (operation === 'getUnits') {
						responseData = await apiRequest.call(this, 'GET', '/catalog/units') as IDataObject;
					} else if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						const qs: IDataObject = {};
						if (filters.search) {
							qs.search = filters.search;
						}
						if (filters.barcode) {
							qs.barcode = filters.barcode;
						}
						if (filters.firstChar) {
							qs.first_char = filters.firstChar;
						}

						if (returnAll) {
							const allData: IDataObject[] = [];
							let page = 1;
							let hasMore = true;
							while (hasMore) {
								const response = await apiRequest.call(this, 'GET', '/catalog', {}, { ...qs, page, per_page: 200 }) as IDataObject;
								const data = (response.data || response) as IDataObject[];
								allData.push(...data);
								hasMore = Array.isArray(data) && data.length === 200;
								page++;
							}
							responseData = allData;
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							const response = await apiRequest.call(this, 'GET', '/catalog', {}, { ...qs, page: 1, per_page: limit }) as IDataObject;
							responseData = (response.data || response) as IDataObject[];
						}
					} else if (operation === 'create') {
						const itemsData = this.getNodeParameter('items', i) as IDataObject;
						const itemsList = (itemsData.item as IDataObject[]) || [];
						const catalogItems = itemsList.map((item) => {
							const catalogItem: IDataObject = {
								name: item.name,
								selling_price: item.sellingPrice,
								unit_id: item.unitId,
							};
							if (item.imageId) {
								catalogItem.image_id = item.imageId;
							}
							if (item.barcode) {
								catalogItem.barcode = item.barcode;
							}
							return catalogItem;
						});
						responseData = await apiRequest.call(this, 'POST', '/catalog', { items: catalogItems }) as IDataObject;
					} else if (operation === 'uploadImage') {
						const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
						const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
						const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);

						// Multipart upload. The request helper runs on axios, which understands a
						// spec-compliant FormData and sets the boundary itself — the old
						// `{ value, options }` shape belonged to the `request` library and was
						// serialised to JSON instead of being uploaded.
						const formData = new FormData();
						formData.append(
							'image',
							new Blob([new Uint8Array(buffer)], { type: binaryData.mimeType }),
							binaryData.fileName || 'image.jpg',
						);

						responseData = await apiRequest.call(this, 'POST', '/catalog/upload-image', formData) as IDataObject;
					} else if (operation === 'update') {
						const itemId = this.getNodeParameter('itemId', i) as number;
						const updateFields = this.getNodeParameter('updateFields', i) as IDataObject;
						const body: IDataObject = {};
						if (updateFields.name) {
							body.name = updateFields.name;
						}
						if (updateFields.sellingPrice) {
							body.selling_price = updateFields.sellingPrice;
						}
						if (updateFields.unitId) {
							body.unit_id = updateFields.unitId;
						}
						if (updateFields.imageId) {
							body.image_id = updateFields.imageId;
						}
						if (updateFields.isImageDeleted !== undefined) {
							body.is_image_deleted = updateFields.isImageDeleted;
						}
						if (updateFields.barcode) {
							body.barcode = updateFields.barcode;
						}
						responseData = await apiRequest.call(this, 'PATCH', `/catalog/${itemId}`, body) as IDataObject;
					} else if (operation === 'bulkDelete') {
						// POST, not DELETE: a body on DELETE is poorly supported by the 1C HTTP
						// clients this endpoint exists for.
						const matchBy = this.getNodeParameter('matchBy', i) as string;
						const raw = this.getNodeParameter('values', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						const values = raw.split(',').map((v) => v.trim()).filter(Boolean);

						const body: IDataObject = matchBy === 'ids'
							? { ids: values.map((v) => Number(v)) }
							: { external_refs: values };
						if (additionalFields.expectedCount) {
							body.expected_count = additionalFields.expectedCount;
						}
						if (additionalFields.dryRun) {
							body.dry_run = true;
						}
						if (additionalFields.idempotencyKey) {
							body.idempotency_key = additionalFields.idempotencyKey;
						}
						// ⚠️ 202 here means "accepted for work", not "deleted": positions come off
						// sale one by one over hours. Progress is read from Get Queue.
						responseData = await apiRequest.call(this, 'POST', '/catalog/bulk-delete', body) as IDataObject;
					} else if (operation === 'scan') {
						const input = this.getNodeParameter('barcode', i) as string;
						responseData = await apiRequest.call(this, 'POST', '/catalog/scan', { input }) as IDataObject;
					} else if (operation === 'getQueue' || operation === 'getErrors') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						const qs: IDataObject = {};
						if (filters.sortOrder) {
							qs.sort_order = filters.sortOrder;
						}
						if (filters.from) {
							qs.from = filters.from;
						}
						if (filters.to) {
							qs.to = filters.to;
						}
						responseData = operation === 'getQueue'
							? await paginate.call(this, '/catalog/queue', qs, returnAll, limit)
							: await paginate.call(this, '/catalog/errors', qs, returnAll, limit);
					} else if (operation === 'getWebhookLogs') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						const qs: IDataObject = {};
						if (filters.status) {
							qs.status = filters.status;
						}
						if (filters.catalogItemId) {
							qs.catalog_item_id = filters.catalogItemId;
						}
						if (filters.createdAfter) {
							qs.created_after = filters.createdAfter;
						}
						if (filters.sortOrder) {
							qs.sort_order = filters.sortOrder;
						}
						responseData = await paginate.call(this, '/catalog/webhook-logs', qs, returnAll, limit);
					} else if (operation === 'delete') {
						const itemId = this.getNodeParameter('itemId', i) as number;
						responseData = await apiRequest.call(this, 'DELETE', `/catalog/${itemId}`) as IDataObject;
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				}

				// ════════════════════════════════════
				// Account
				// ════════════════════════════════════
				else if (resource === 'account') {
					if (operation === 'getHealth') {
						responseData = await apiRequest.call(this, 'GET', '/account/health') as IDataObject;
					} else if (operation === 'getTariff') {
						responseData = await apiRequest.call(this, 'GET', '/tariff') as IDataObject;
					} else if (operation === 'getPlans') {
						responseData = await apiRequest.call(this, 'GET', '/tariff/plans') as IDataObject;
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				}

				// ════════════════════════════════════
				// Cashbox
				// ════════════════════════════════════
				else if (resource === 'cashbox') {
					// Present on most cashbox routes; 0 means "let the server take the primary cashier".
					const cashierId = ['getSummary', 'getReconciliation', 'getShifts', 'closeShift', 'setAutoClose', 'setAutoWithdrawal'].includes(operation)
						? (this.getNodeParameter('kaspiConnectionId', i) as number)
						: 0;

					if (operation === 'getSummary') {
						const date = this.getNodeParameter('date', i) as string;
						const qs: IDataObject = {};
						if (date) {
							qs.date = date;
						}
						if (cashierId) {
							qs.kaspi_connection_id = cashierId;
						}
						responseData = await apiRequest.call(this, 'GET', '/cashbox/summary', {}, qs) as IDataObject;
					} else if (operation === 'getReconciliation') {
						const qs: IDataObject = { shift_id: this.getNodeParameter('shiftId', i) as number };
						if (cashierId) {
							qs.kaspi_connection_id = cashierId;
						}
						responseData = await apiRequest.call(this, 'GET', '/cashbox/reconciliation', {}, qs) as IDataObject;
					} else if (operation === 'getShifts') {
						const qs: IDataObject = {
							date_from: this.getNodeParameter('dateFrom', i) as string,
							date_to: this.getNodeParameter('dateTo', i) as string,
						};
						if (cashierId) {
							qs.kaspi_connection_id = cashierId;
						}
						responseData = await apiRequest.call(this, 'GET', '/cashbox/shifts', {}, qs) as IDataObject;
					} else if (operation === 'getShiftReport') {
						const shiftId = this.getNodeParameter('shiftId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/cashbox/shifts/${shiftId}/report`) as IDataObject;
					} else if (operation === 'closeShift') {
						// Asynchronous: answers 202 with an operation to poll via Get Operation.
						const body: IDataObject = {
							client_operation_id: this.getNodeParameter('clientOperationId', i) as string,
							shift_number: this.getNodeParameter('shiftNumber', i) as number,
						};
						if (cashierId) {
							body.kaspi_connection_id = cashierId;
						}
						responseData = await apiRequest.call(this, 'POST', '/cashbox/shifts/close', body) as IDataObject;
					} else if (operation === 'getOperation') {
						const operationId = this.getNodeParameter('operationId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/cashbox/operations/${operationId}`) as IDataObject;
					} else if (operation === 'getSettings') {
						responseData = await apiRequest.call(this, 'GET', '/cashbox/settings') as IDataObject;
					} else if (operation === 'setAutoClose' || operation === 'setAutoWithdrawal') {
						const body: IDataObject = { enabled: this.getNodeParameter('enabled', i) as boolean };
						if (cashierId) {
							body.kaspi_connection_id = cashierId;
						}
						// Two literal paths rather than one computed endpoint: the canon gate reads
						// coverage off these call sites, and a path built in a variable is invisible
						// to it — the operation would look unimplemented while working fine.
						responseData = operation === 'setAutoClose'
							? await apiRequest.call(this, 'PUT', '/cashbox/settings/auto-close', body) as IDataObject
							: await apiRequest.call(this, 'PUT', '/cashbox/settings/auto-withdrawal', body) as IDataObject;
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				}

				// ════════════════════════════════════
				// Client
				// ════════════════════════════════════
				else if (resource === 'client') {
					if (operation === 'check') {
						const phone = this.getNodeParameter('phoneNumber', i) as string;
						responseData = await apiRequest.call(this, 'POST', '/clients/check', { phone }) as IDataObject;
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				}

				// ════════════════════════════════════
				// Webhook Log
				// ════════════════════════════════════
				else if (resource === 'webhookLog') {
					if (operation === 'get') {
						const webhookLogId = this.getNodeParameter('webhookLogId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/webhook-logs/${webhookLogId}`) as IDataObject;
					} else if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const limit = returnAll ? 0 : (this.getNodeParameter('limit', i) as number);
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						const qs: IDataObject = {};
						if (filters.invoiceId) {
							qs.invoice_id = filters.invoiceId;
						}
						if (filters.event) {
							qs.event = filters.event;
						}
						if (filters.status) {
							qs.status = filters.status;
						}
						if (filters.dateFrom) {
							qs.date_from = filters.dateFrom;
						}
						if (filters.dateTo) {
							qs.date_to = filters.dateTo;
						}
						if (filters.sortBy) {
							qs.sort_by = filters.sortBy;
						}
						if (filters.sortOrder) {
							qs.sort_order = filters.sortOrder;
						}
						responseData = await paginate.call(this, '/webhook-logs', qs, returnAll, limit);
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				}

				// ════════════════════════════════════
				// QR Refund
				// ════════════════════════════════════
				else if (resource === 'qrRefund') {
					if (operation === 'createLink') {
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						const body: IDataObject = {};
						if (additionalFields.kaspiConnectionId) {
							body.kaspi_connection_id = additionalFields.kaspiConnectionId;
						}
						if (additionalFields.invoiceId) {
							body.invoice_id = additionalFields.invoiceId;
						}
						if (additionalFields.amount) {
							body.amount = additionalFields.amount;
						}
						if (additionalFields.returnItems) {
							const lines = ((additionalFields.returnItems as IDataObject).item as IDataObject[]) || [];
							if (lines.length) {
								body.return_items = lines.map((item) => ({
									catalog_item_id: item.catalogItemId,
									// Exactly one of count or amount per line; the server refuses both.
									...(item.count ? { count: item.count } : {}),
									...(!item.count && item.amount ? { amount: item.amount } : {}),
								}));
							}
						}
						responseData = await apiRequest.call(this, 'POST', '/qr-refunds/links', body) as IDataObject;
					} else if (operation === 'revokeLink') {
						const linkId = this.getNodeParameter('linkId', i) as number;
						responseData = await apiRequest.call(this, 'DELETE', `/qr-refunds/links/${linkId}`) as IDataObject;
					} else if (operation === 'get') {
						const sessionId = this.getNodeParameter('sessionId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/qr-refunds/${sessionId}`) as IDataObject;
					} else if (operation === 'getOperations') {
						const sessionId = this.getNodeParameter('sessionId', i) as number;
						const cursor = this.getNodeParameter('cursor', i) as string;
						responseData = await apiRequest.call(this, 'GET', `/qr-refunds/${sessionId}/operations`, {}, cursor ? { cursor } : {}) as IDataObject;
					} else if (operation === 'getOperation') {
						const sessionId = this.getNodeParameter('sessionId', i) as number;
						const operationRef = this.getNodeParameter('operationRef', i) as string;
						responseData = await apiRequest.call(this, 'GET', `/qr-refunds/${sessionId}/operations/${operationRef}`) as IDataObject;
					} else if (operation === 'execute') {
						const sessionId = this.getNodeParameter('sessionId', i) as number;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						const body: IDataObject = {
							operation_ref: this.getNodeParameter('operationRef', i) as string,
						};
						if (additionalFields.items) {
							const lines = ((additionalFields.items as IDataObject).item as IDataObject[]) || [];
							if (lines.length) {
								body.items = lines.map((item) => ({
									ref: item.ref,
									...(item.amount ? { amount: item.amount } : {}),
								}));
							}
						}
						if (!body.items && additionalFields.amount) {
							body.amount = additionalFields.amount;
						}
						if (additionalFields.simulateStatus) {
							const simulate: IDataObject = { status: additionalFields.simulateStatus };
							if (additionalFields.simulateStatus === 'failed' && additionalFields.simulateErrorCode) {
								simulate.error_code = additionalFields.simulateErrorCode;
							}
							body.simulate = simulate;
						}
						responseData = await executeQrRefund.call(this, sessionId, body);
					} else if (operation === 'simulate') {
						const sessionId = this.getNodeParameter('sessionId', i) as number;
						const event = this.getNodeParameter('event', i) as string;
						responseData = await apiRequest.call(this, 'POST', `/qr-refunds/${sessionId}/simulate`, { event }) as IDataObject;
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				}

				// ════════════════════════════════════
				// Receipt
				// ════════════════════════════════════
				else if (resource === 'receipt') {
					if (operation === 'issue') {
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						const cartItemsData = this.getNodeParameter('cartItems', i) as IDataObject;
						const lines = (cartItemsData.item as IDataObject[]) || [];

						const body: IDataObject = {
							payment_type: this.getNodeParameter('paymentType', i) as number,
							client_operation_id: this.getNodeParameter('clientOperationId', i) as string,
							// ⚠️ This route names the quantity field `quantity`, while the invoice
							// routes name it `count`. Reusing cartItemsFrom here would send the
							// wrong key and the receipt would be refused.
							cart_items: lines.map((item) => ({
								catalog_item_id: item.catalogItemId,
								quantity: item.quantity,
								...(item.price ? { price: item.price } : {}),
							})),
						};
						if (additionalFields.kaspiConnectionId) {
							body.kaspi_connection_id = additionalFields.kaspiConnectionId;
						}
						if (additionalFields.receivedAmt) {
							body.received_amt = additionalFields.receivedAmt;
						}
						if (additionalFields.simulateStatus) {
							const simulate: IDataObject = { status: additionalFields.simulateStatus };
							if (additionalFields.simulateStatus === 'failed' && additionalFields.simulateErrorCode) {
								simulate.error_code = additionalFields.simulateErrorCode;
							}
							body.simulate = simulate;
						}
						responseData = await apiRequest.call(this, 'POST', '/receipts', body) as IDataObject;
					} else if (operation === 'preview') {
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						const body: IDataObject = {
							payment_type: this.getNodeParameter('paymentType', i) as number,
							total_price: this.getNodeParameter('totalPrice', i) as number,
						};
						if (additionalFields.kaspiConnectionId) {
							body.kaspi_connection_id = additionalFields.kaspiConnectionId;
						}
						responseData = await apiRequest.call(this, 'POST', '/receipts/preview', body) as IDataObject;
					} else if (operation === 'get') {
						const receiptId = this.getNodeParameter('receiptId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/receipts/${receiptId}`) as IDataObject;
					} else if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						const filters = this.getNodeParameter('filters', i) as IDataObject;
						const qs: IDataObject = {};
						if (filters.status) {
							qs.status = filters.status;
						}
						if (filters.paymentType) {
							qs.payment_type = filters.paymentType;
						}
						if (filters.invoiceId) {
							qs.invoice_id = filters.invoiceId;
						}
						if (filters.from) {
							qs.from = filters.from;
						}
						if (filters.to) {
							qs.to = filters.to;
						}

						if (returnAll) {
							const allData: IDataObject[] = [];
							let page = 1;
							let hasMore = true;
							while (hasMore) {
								const response = await apiRequest.call(this, 'GET', '/receipts', {}, { ...qs, page, per_page: 100 }) as IDataObject;
								const data = (response.data as IDataObject[]) || [];
								allData.push(...data);
								hasMore = data.length === 100;
								page++;
							}
							responseData = allData;
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							const response = await apiRequest.call(this, 'GET', '/receipts', {}, { ...qs, page: 1, per_page: limit }) as IDataObject;
							responseData = (response.data as IDataObject[]) || [];
						}
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				}

				// ════════════════════════════════════
				// Static QR
				// ════════════════════════════════════
				else if (resource === 'staticQr') {
					if (operation === 'create') {
						const amount = this.getNodeParameter('amount', i) as number;
						const description = this.getNodeParameter('description', i) as string;
						const additionalFields = this.getNodeParameter('additionalFields', i) as IDataObject;
						const body: IDataObject = {};
						if (amount > 0) {
							body.amount = amount;
						}
						if (description) {
							body.description = description;
						}
						if (additionalFields.externalOrderId) {
							body.external_order_id = additionalFields.externalOrderId;
						}
						if (additionalFields.kaspiConnectionId) {
							body.kaspi_connection_id = additionalFields.kaspiConnectionId;
						}
						if (additionalFields.discountPercentage) {
							body.discount_percentage = additionalFields.discountPercentage;
						}
						if (additionalFields.expiresAt) {
							body.expires_at = additionalFields.expiresAt;
						}
						if (additionalFields.singleUse !== undefined) {
							body.single_use = additionalFields.singleUse;
						}
						const sheetCartItems = cartItemsFrom(additionalFields);
						if (sheetCartItems) {
							body.cart_items = sheetCartItems;
						}
						responseData = await apiRequest.call(this, 'POST', '/static-qr', body) as IDataObject;
					} else if (operation === 'get') {
						const staticQrId = this.getNodeParameter('staticQrId', i) as number;
						responseData = await apiRequest.call(this, 'GET', `/static-qr/${staticQrId}`) as IDataObject;
					} else if (operation === 'disable') {
						const staticQrId = this.getNodeParameter('staticQrId', i) as number;
						responseData = await apiRequest.call(this, 'DELETE', `/static-qr/${staticQrId}`) as IDataObject;
					} else if (operation === 'getAll') {
						const returnAll = this.getNodeParameter('returnAll', i) as boolean;
						if (returnAll) {
							const allData: IDataObject[] = [];
							let page = 1;
							let hasMore = true;
							while (hasMore) {
								const response = await apiRequest.call(this, 'GET', '/static-qr', {}, { page, per_page: 100 }) as IDataObject;
								const data = (response.data as IDataObject[]) || [];
								allData.push(...data);
								hasMore = data.length === 100;
								page++;
							}
							responseData = allData;
						} else {
							const limit = this.getNodeParameter('limit', i) as number;
							const response = await apiRequest.call(this, 'GET', '/static-qr', {}, { page: 1, per_page: limit }) as IDataObject;
							responseData = (response.data as IDataObject[]) || [];
						}
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				}

				// ════════════════════════════════════
				// Status
				// ════════════════════════════════════
				else if (resource === 'status') {
					if (operation === 'healthCheck') {
						responseData = await apiRequest.call(this, 'GET', '/status') as IDataObject;
					} else {
						throw new NodeApiError(this.getNode(), { message: `Unknown operation: ${operation}` });
					}
				} else {
					throw new NodeApiError(this.getNode(), { message: `Unknown resource: ${resource}` });
				}

				const executionData = this.helpers.constructExecutionMetaData(
					this.helpers.returnJsonArray(responseData as IDataObject | IDataObject[]),
					{ itemData: { item: i } },
				);
				returnData.push(...executionData);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: describeApiFailure(error), pairedItem: { item: i } });
					continue;
				}
				const failure = describeApiFailure(error);
				if (failure.refundOutcome === 'unproven') {
					// The workflow stops here either way, but the person reading the red node has
					// to see WHY a retry is the wrong move — the money may already be gone.
					throw new NodeApiError(this.getNode(), error as JsonObject, {
						itemIndex: i,
						message: `Refund outcome is not proven (${failure.errorCode as string})`,
						description:
							'Kaspi may already have moved the money. Do not re-run this node: a second attempt can refund twice. Read the session with QR Refund → Get and take it to support.',
					});
				}
				// Always wrapped, never re-thrown raw: an unwrapped error loses the node and the
				// item it came from, and n8n's own rule for community nodes forbids it.
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}
		return [returnData];
	}
}
