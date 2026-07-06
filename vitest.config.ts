import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/ui/**'],
        },
      },
      {
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/ui/**/*.test.tsx'],
        },
      },
    ],
  },
})
