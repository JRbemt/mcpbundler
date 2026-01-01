import { defineConfig, mergeConfig, UserConfig } from 'vite';
import baseConfig from './vitest.config.js';

export default mergeConfig(
  baseConfig as UserConfig,
  defineConfig({
    test: {
      include: ['tests/integration/**/*.{test,spec}.{js,ts}'],
      name: 'integration',
      testTimeout: 30000
    }
  })
);
