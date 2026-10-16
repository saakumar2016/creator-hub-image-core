import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Browser modules (canvas, downloads) need a DOM; the Pages helpers use Node APIs too.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
