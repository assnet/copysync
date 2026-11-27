import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// https://vite.dev/config/
// LP do Meta Ads (VITE_CHECKOUT_CHANNEL=meta): fora do Google, para a venda das ofertas [M] vir só do anúncio.
const noindexForMeta = (channel: string | undefined): Plugin => ({
  name: 'noindex-meta-channel',
  transformIndexHtml: (html) =>
    channel === 'meta' ? html.replace('</title>', '</title>\n    <meta name="robots" content="noindex, nofollow">') : html,
})

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd()), ...process.env }
  return { plugins: [react(), tailwindcss(), noindexForMeta(env.VITE_CHECKOUT_CHANNEL)] }
})
