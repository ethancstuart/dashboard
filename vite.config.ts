/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: { manifest: true },
  test: { environment: 'happy-dom' },
});
