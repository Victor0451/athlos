import { expect, it } from 'vitest'
import { envSchema } from './schema.ts'

// prettier-ignore
const required = { DATABASE_URL: 'postgresql://localhost/athlos', JWT_SECRET: 'x'.repeat(32), JWT_REFRESH_SECRET: 'y'.repeat(32), LEGACY_DB_PATH: '/tmp/legacy' }

// prettier-ignore
it('defaults ctacte compatibility off and parses its explicit gate',()=>{expect(envSchema.parse(required).DUES_CTACTE_PROJECTION_ENABLED).toBe(false); expect(envSchema.parse({...required,DUES_CTACTE_PROJECTION_ENABLED:'true'}).DUES_CTACTE_PROJECTION_ENABLED).toBe(true)})
