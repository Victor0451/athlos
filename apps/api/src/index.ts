// dotenv/config MUST be imported first so the rest of the app sees env vars
// at module init time (per openspec/changes/athlos-foundation/specs/config-environment).
import 'dotenv/config'

import { buildServer } from './server.js'

const PORT = Number(process.env['PORT'] ?? 3001)
const HOST = process.env['HOST'] ?? '0.0.0.0'

async function main() {
  const app = await buildServer()
  try {
    await app.listen({ port: PORT, host: HOST })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
