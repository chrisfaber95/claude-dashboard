import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Component tests only (docs/code-style.md): `node --test` runs the `*.test.ts` files, Vitest runs these.
// The Vue plugin compiles `.vue` files, including `<template src>` files.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['tests/client/**/*.component.spec.ts'],
  },
});
