import { defineConfig } from 'vitest/config'
import path from 'node:path'

const alias = {
  '@': path.resolve(__dirname, './src'),
}

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/ui/**'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/ui/**/*.test.tsx'],
        },
      },
    ],
  },
})
