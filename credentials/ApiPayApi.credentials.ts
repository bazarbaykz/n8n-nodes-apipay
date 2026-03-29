import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class ApiPayApi implements ICredentialType {
  name = 'apiPayApi';
  displayName = 'ApiPay API';
  documentationUrl = 'https://apipay.kz/docs';
  icon = 'file:apipay.svg' as const;

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'API key from your ApiPay.kz dashboard',
    },
    {
      displayName: 'Webhook Secret',
      name: 'webhookSecret',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'Webhook secret for HMAC-SHA256 signature verification. Required only for ApiPay Trigger node.',
    },
    {
      displayName: 'Environment',
      name: 'environment',
      type: 'options',
      options: [
        { name: 'Production', value: 'production' },
        { name: 'Sandbox', value: 'sandbox' },
      ],
      default: 'sandbox',
      description: 'Whether to use sandbox or production environment. Both use the same API endpoint, but sandbox returns synchronous responses.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        'X-API-Key': '={{$credentials.apiKey}}',
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: 'https://bpapi.bazarbay.site/api/v1',
      url: '/invoices',
      qs: { per_page: '1' },
      method: 'GET',
    },
  };
}
