// Fixture for tests/lint-config.test.ts: breaks the type-safety rules on purpose. Not part of `npm run lint`.
const raw: unknown = JSON.parse('{"count":1}');
export const parsed = raw as { count: number };
export const maybe: { count?: number } = {};
export const count = maybe.count!;
export const anything: any = raw;
export function loose(value: string) {
  return value.length;
}
export const fixed = [1, 2] as const;
