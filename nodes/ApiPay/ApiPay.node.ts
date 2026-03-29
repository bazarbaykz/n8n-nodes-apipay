import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

async function apiRequest(
	this: IExecuteFunctions,
	method: IHttpRequestOptions['method'],
	endpoint: string,
	body: IDataObject = {},
	qs: IDataObject = {},
): Promise<IDataObject | IDataObject[]> {
	const options: IHttpRequestOptions = {
		url: `https://bpapi.bazarbay.site/api/v1${endpoint}`,
		method,
		body: Object.keys(body).length ? body : undefined,
		qs: Object.keys(qs).length ? qs : undefined,
		json: true,
	};
	return await this.helpers.httpRequestWithAuthentication.call(this, 'apiPayApi', options) as IDataObject | IDataObject[];
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
		inputs: ['main'],
		outputs: ['main'],
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
					{ name: 'Catalog', value: 'catalog' },
					{ name: 'Invoice', value: 'invoice' },
					{ name: 'Refund', value: 'refund' },
					{ name: 'Status', value: 'status' },
					{ name: 'Subscription', value: 'subscription' },
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
					{ name: 'Create', value: 'create', description: 'Create an invoice', action: 'Create an invoice' },
					{ name: 'Get', value: 'get', description: 'Get an invoice', action: 'Get an invoice' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many invoices', action: 'Get many invoices' },
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
					{ name: 'Create', value: 'create', description: 'Create catalog items', action: 'Create catalog items' },
					{ name: 'Delete', value: 'delete', description: 'Delete a catalog item', action: 'Delete a catalog item' },
					{ name: 'Get Many', value: 'getAll', description: 'Get many catalog items', action: 'Get many catalog items' },
					{ name: 'Get Units', value: 'getUnits', description: 'Get catalog units', action: 'Get catalog units' },
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
				typeOptions: { minValue: 0.01, maxValue: 99999999.99, numberPrecision: 2 },
				description: 'Invoice amount (0.01-99999999.99). Required if no cart items provided.',
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
				description: 'Invoice description (max 500 characters)',
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
										displayName: 'Catalog Item ID',
										name: 'catalogItemId',
										type: 'number',
										default: 0,
										description: 'ID of the catalog item',
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
				],
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
							{ name: 'Refunded', value: 'refunded' },
						],
						default: [],
						description: 'Filter by invoice status',
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
										displayName: 'Catalog Item ID',
										name: 'catalogItemId',
										type: 'number',
										default: 0,
										description: 'ID of the catalog item to return',
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
						description: 'Day of the billing period (1-28)',
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
										displayName: 'Catalog Item ID',
										name: 'catalogItemId',
										type: 'number',
										default: 0,
										description: 'ID of the catalog item',
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
										displayName: 'Catalog Item ID',
										name: 'catalogItemId',
										type: 'number',
										default: 0,
										description: 'ID of the catalog item',
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
				description: 'Catalog items to create (max 50)',
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
								displayName: 'Unit ID',
								name: 'unitId',
								type: 'number',
								default: 0,
								required: true,
								description: 'Unit of measurement ID (use Get Units to find available units)',
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
						displayName: 'Unit ID',
						name: 'unitId',
						type: 'number',
						default: 0,
						description: 'New unit of measurement ID',
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
						const body: IDataObject = {
							amount: this.getNodeParameter('amount', i) as number,
							phone_number: this.getNodeParameter('phoneNumber', i) as string,
						};
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
						responseData = await apiRequest.call(this, 'POST', '/invoices', body) as IDataObject;
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

						const options: IHttpRequestOptions = {
							url: 'https://bpapi.bazarbay.site/api/v1/catalog/upload-image',
							method: 'POST',
							body: {
								image: {
									value: buffer,
									options: {
										filename: binaryData.fileName || 'image.jpg',
										contentType: binaryData.mimeType,
									},
								},
							},
							json: true,
						};
						responseData = await this.helpers.httpRequestWithAuthentication.call(this, 'apiPayApi', options) as IDataObject;
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
					} else if (operation === 'delete') {
						const itemId = this.getNodeParameter('itemId', i) as number;
						responseData = await apiRequest.call(this, 'DELETE', `/catalog/${itemId}`) as IDataObject;
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
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}
		return [returnData];
	}
}
