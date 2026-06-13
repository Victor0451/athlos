/**
 * Global Vitest setup file. Runs before every test file in the consuming
 * package. PR 10a ships a stub; PR 10b (E2E + CI) extends this with:
 *   - Testcontainers Postgres boot/teardown
 *   - Timezone pinning to UTC
 *   - `fetch` mock registration
 *   - Env-var loader for test secrets
 *
 * Per the testing-setup spec §H, this is the file where shared test
 * configuration lives so individual tests stay focused on behavior.
 */
export {}
