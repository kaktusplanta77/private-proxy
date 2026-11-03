# Private Proxy

A web proxy that runs on Cloudflare Workers and **stores nothing**.

- No database, no KV, no files, no logs. Every request is handled in memory and forgotten.
- Your logins are kept only as cookies in **your own browser**, never on the server.
- Each site's cookies are kept separate (under `/p/https://that-site/`), so one site doesn't receive another site's cookies.
- Open source, so anyone can read exactly what it does.

## How it works

Open `https://your-proxy.workers.dev/p/https://example.com` and the Worker fetches
`example.com` for you, rewrites every link, image, script and form so it keeps going
through the proxy, and sends the page back.

| File | What it does |
| --- | --- |
| `src/index.js` | The Worker: fetches sites, rewrites HTML/CSS, redirects and cookies |
| `src/client.js` | Script injected into each page: catches `fetch`, XHR, WebSockets, `document.cookie`, new elements |
| `src/sw.js` | Service worker: catches any request the page script missed |
| `src/urls.js` | URL rewriting helpers |
| `src/pages.js` | Home page and error pages |

## Run it on your computer

```bash
npm install
npm run dev
```

Then open http://127.0.0.1:8787

## Put it online (GitHub + Cloudflare)

1. Push this folder to a GitHub repository.
2. In the Cloudflare dashboard go to **Workers & Pages → Create → Import a repository**, pick the repo, and deploy.
   Every push to GitHub then redeploys automatically.

Or deploy straight from your computer with `npx wrangler login` then `npm run deploy`.

## Honest limits

- **A proxy can technically see everything.** Traffic is decrypted inside the Worker so it can be rewritten.
  This code throws it away, but visitors have to trust that the deployed Worker is this code.
  Cloudflare also handles the traffic.
- **All proxied sites share one browser origin.** A malicious site opened through the proxy could read
  `localStorage` or non-HttpOnly cookies left by other sites. Use **Clear my data** (`/__proxy/clear`) after logging in to anything important.
- **Some logins won't work.** Google, Microsoft, banks and others detect proxies and block sign-in.
  Sites that use captchas or heavy bot protection may also fail.
- **Cloudflare's terms** restrict running VPN/proxy services on their platform, so your account or
  `workers.dev` subdomain could be suspended. Proxies that show login pages also often get flagged as phishing by browsers.
- Very JavaScript-heavy apps may partly break, because scripts that read `location` see the proxy's address.
