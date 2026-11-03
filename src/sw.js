// Service worker: runs in the visitor's browser and routes any request that
// escaped the page rewriting back through the proxy. Stores nothing.
function swMain() {
  const PREFIX = "/p/";
  const ORIGIN = self.location.origin;

  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

  function targetFrom(clientUrl) {
    try {
      const u = new URL(clientUrl);
      if (!u.pathname.startsWith(PREFIX)) return null;
      return u.pathname.slice(PREFIX.length).replace(/^(https?):\/+/i, "$1://") + u.search;
    } catch {
      return null;
    }
  }

  async function forward(req, path) {
    const init = {
      method: req.method,
      headers: req.headers,
      credentials: "same-origin",
      redirect: "follow",
    };
    if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();
    return fetch(ORIGIN + path, init);
  }

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.mode === "navigate") return; // the server handles page loads
    let url;
    try {
      url = new URL(req.url);
    } catch {
      return;
    }

    if (url.origin === ORIGIN) {
      // Already going through the proxy, or one of our own files.
      if (url.pathname.startsWith(PREFIX) || url.pathname.startsWith("/__proxy/") || url.pathname === "/") return;
      // A root-relative URL like "/api/data" that should belong to the proxied site.
      event.respondWith(
        (async () => {
          const client = event.clientId ? await self.clients.get(event.clientId) : null;
          const target = client && targetFrom(client.url);
          if (!target) return fetch(req);
          return forward(req, PREFIX + new URL(url.pathname + url.search, target).href);
        })()
      );
      return;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    event.respondWith(forward(req, PREFIX + url.href));
  });
}

// The bundler may add calls to a __name() helper; define it so the script runs in the browser.
export const SW_JS = `var __name=function(f){return f};(${swMain.toString()})();`;
