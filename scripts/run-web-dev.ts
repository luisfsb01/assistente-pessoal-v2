import { resolve } from 'node:path'
import { createServer as createViteServer } from 'vite'
import { startWebServer } from '../apps/server/src/api/server.js'
import { getConfig } from '../apps/server/src/lib/config.js'

const repoRoot = resolve(import.meta.dirname, '..')
const webRoot = resolve(repoRoot, 'apps/web')

// O Vite encaminha /api para a porta 8080. Os dois servidores vivem no
// mesmo processo para que `npm run web:dev` sempre entregue a tela e a API.
startWebServer(getConfig())

const vite = await createViteServer({
  root: webRoot,
  configFile: resolve(webRoot, 'vite.config.ts'),
})
await vite.listen()
vite.printUrls()
