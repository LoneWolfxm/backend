import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildOpenApiDocument } from '../src/api/core/openapi'
import '../src/app'

const outPath = join(__dirname, '..', 'openapi.json')
writeFileSync(outPath, JSON.stringify(buildOpenApiDocument(), null, 2))
console.log(`Wrote ${outPath}`)
