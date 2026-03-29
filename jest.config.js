module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'credentials/**/*.ts',
    'nodes/**/*.ts',
    '!**/dist/**',
  ],
};
