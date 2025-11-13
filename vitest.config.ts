import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/**/*.{test,spec}.{js,ts}',
      'src/**/*.{test,spec}.{js,ts}'
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.d.ts'
    ],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/coverage/**',
        'src/utils/logger.ts'
      ]
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tests': path.resolve(__dirname, './tests')
    }
  }
});