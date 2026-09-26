import { config } from '@n8n/node-cli/eslint';
export default [
	...config,
	{
		files: ['__tests__/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'@typescript-eslint/no-require-imports': 'off',
			// The cloud-compatibility rule keeps the PACKAGE free of dependencies, and tests are
			// not part of it: `files` ships only `dist`. The package-hygiene test has to read the
			// tarball, which needs fs, path and child_process.
			'@n8n/community-nodes/no-restricted-imports': 'off',
			'@n8n/community-nodes/no-dangerous-functions': 'off',
		},
	},
];
