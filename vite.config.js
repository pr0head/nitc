import { defineConfig } from 'vite';

// Netgress upstream. The browser cannot call this directly in dev: the server
// only allows the two Ingress intel origins (others → 403 origin_denied), and a
// localhost / GitHub Pages origin is not one of them. We dodge that two ways:
//   dev  — Vite proxies /api → upstream server-side and strips the Origin header,
//          so the request reaches Netgress as a no-Origin (non-browser) call,
//          which it accepts with a valid token.
//   prod — static hosting has no proxy, so the production origin must be
//          whitelisted by the Netgress owner (we have the author's blessing),
//          or VITE_API_BASE must point at an allowed proxy.
const UPSTREAM = process.env.VITE_UPSTREAM || 'https://api.netgress.ru';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the repo at /nitc/; dev server at root.
  base: command === 'build' ? (process.env.VITE_BASE || '/nitc/') : '/',
  server: {
    proxy: {
      '/api': {
        target: UPSTREAM,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
        configure: (proxy) => {
          // Make it a non-browser request: no Origin/Referer → CORS allowlist
          // does not apply, upstream accepts it with the Bearer token.
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
        },
      },
    },
  },
}));
