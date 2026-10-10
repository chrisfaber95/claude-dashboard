import { defineConfig } from 'vitest/config';

// Component tests only (docs/code-style.md): `node --test` runs the `*.test.ts` files, Vitest runs these.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/client/**/*.component.spec.ts'],
  },
});
