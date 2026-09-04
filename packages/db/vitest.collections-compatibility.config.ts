import { createConfig } from '@athlos/vitest-config'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: createConfig('node', {
    include: ['src/scripts/collections-compatibility.postgres.integration.test.ts'],
    fileParallelism: false,
  }),
})
