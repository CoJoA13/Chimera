import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      electron: resolve(__dirname, 'tests/stubs/electron.ts')
    }
  },
  test: {
    environment: 'node'
  }
})
