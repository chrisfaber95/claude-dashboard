// Fixture for tests/lint-config.test.ts: breaks the readability rules on purpose. Not part of `npm run lint`.
export const fmt = (value: number) => (value > 1 ? (value > 2 ? 'a' : 'b') : 'c');
