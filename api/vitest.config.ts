import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Run in a US time zone, where the local date often differs from the UTC
    // date, so code that uses the local date instead of UTC fails the tests.
    env: { TZ: 'America/Chicago' },
  },
})
