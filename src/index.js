// Private Proxy - a Cloudflare Worker web proxy that stores nothing.
// No KV, no D1, no R2, no Durable Objects, no logging. Every request is handled
// in memory and forgotten. Logins stay as cookies in the visitor's own browser.

import { PREFIX, fixScheme, proxify, proxifySrcset, rewriteCss, unproxify } from "./urls.js";
import { CLIENT_JS } from "./client.js";
import { SW_JS } from "./sw.js";
import { HOME_HTML, CLEARED_HTML, errorPage } from "./pages.js";

// Request headers we never pass to the target site (they could reveal the visitor).
const DROP_REQUEST_HEADERS = new Set([
  "host", "cookie", "content-length", "x-real-ip", "true-client-ip", "forwarded", "via", "cdn-loop",
]);

// Response headers that would break the proxy or let one site wipe/lock another.
const DROP_RESPONSE_HEADERS = [
  "content-security-policy", "content-security-policy-report-only", "x-frame-options",
  "strict-transport-security", "clear-site-data", "cross-origin-embedder-policy",
  "cross-origin-opener-policy", "cross-origin-resource-policy", "permissions-policy",
  "report-to", "nel", "link", "set-cookie", "alt-svc", "public-key-pins",
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = url.origin;

    if (url.pathname === "/") return html(HOME_HTML);
    if (url.pathname === "/__proxy/client.js") return js(CLIENT_JS);
    if (url.pathname === "/__proxy/sw.js") return js(SW_JS, { "service-worker-allowed": "/" });
    if (url.pathname === "/__proxy/clear") {
      return html(CLEARED_HTML, 200, { "clear-site-data": '"cookies", "storage", "cache"' });
    }
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n");

    if (url.pathname.startsWith(PREFIX)) {
      const target = fixScheme(url.pathname.slice(PREFIX.length)) + url.search;
      return proxy(request, target, origin);
    }

    // A page asked for something like "/style.css" from the proxy root.
    // Work out which site it belongs to from the Referer and redirect there.
    const ref = request.headers.get("referer");
    const refTarget = ref && unproxify(ref, origin);
    if (refTarget) {
      const fixed = new URL(url.pathname + url.search, refTarget).href;
      return Response.redirect(origin + PREFIX + fixed, 307);
    }

    return html(errorPage("Not found", "That page doesn't exist on this proxy."), 404);
  },
};

async function proxy(request, targetStr, origin) {
  let target;
  try {
    target = new URL(targetStr);
  } catch {
    return html(errorPage("Bad address", "That doesn't look like a valid web address."), 400);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return html(errorPage("Bad address", "Only http and https sites are supported."), 400);
  }
  if (target.host === new URL(origin).host) {
    return html(errorPage("Loop", "The proxy can't open itself."), 400);
  }

  // Build the outgoing request.
  const headers = new Headers();
  for (const [k, v] of request.headers) {
    const lk = k.toLowerCase();
    if (DROP_REQUEST_HEADERS.has(lk) || lk.startsWith("cf-") || lk.startsWith("x-forwarded")) continue;
    headers.set(k, v);
  }
  if (request.headers.has("origin")) headers.set("origin", target.origin);
  const ref = request.headers.get("referer");
  const realRef = ref && unproxify(ref, origin);
  if (realRef) headers.set("referer", realRef);
  else headers.delete("referer");
  const cookie = outgoingCookies(request.headers.get("cookie"));
  if (cookie) headers.set("cookie", cookie);

  const isWebSocket = (request.headers.get("upgrade") || "").toLowerCase() === "websocket";
  const hasBody = !["GET", "HEAD"].includes(request.method);

  let upstream;
  try {
    upstream = await fetch(target.href, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
    });
  } catch (err) {
    return html(errorPage("Couldn't reach that site", `${target.host} didn't respond. Check the address and try again.`), 502);
  }

  if (isWebSocket) return upstream; // pass the live socket straight through

  // Build the response.
  const out = new Headers(upstream.headers);
  for (const h of DROP_RESPONSE_HEADERS) out.delete(h);
  out.set("referrer-policy", "same-origin");
  out.set("x-robots-tag", "noindex, nofollow");

  for (const c of getSetCookies(upstream.headers)) out.append("set-cookie", rewriteSetCookie(c, target));

  const loc = upstream.headers.get("location");
  if (loc) out.set("location", origin + proxify(loc, target.href));

  const noBody = request.method === "HEAD" || [204, 304].includes(upstream.status) || !upstream.body;
  const type = (upstream.headers.get("content-type") || "").toLowerCase();

  if (!noBody && type.includes("text/html")) {
    out.delete("content-length");
    out.delete("content-encoding");
    const res = new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
    return rewriteHtml(res, target);
  }

  if (!noBody && type.includes("text/css")) {
    out.delete("content-length");
    out.delete("content-encoding");
    const css = rewriteCss(await upstream.text(), target.href);
    return new Response(css, { status: upstream.status, statusText: upstream.statusText, headers: out });
  }

  return new Response(noBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

// ---------- HTML rewriting ----------

const URL_ATTRS = {
  "a[href]": "href", "area[href]": "href", "link[href]": "href",
  "img[src]": "src", "script[src]": "src", "iframe[src]": "src", "frame[src]": "src",
  "embed[src]": "src", "source[src]": "src", "video[src]": "src", "audio[src]": "src",
  "track[src]": "src", "input[src]": "src", "video[poster]": "poster", "object[data]": "data",
  "form[action]": "action", "button[formaction]": "formaction", "input[formaction]": "formaction",
};

function rewriteHtml(res, target) {
  const ctx = { base: target.href, injected: false };
  const config = JSON.stringify({ url: target.href }).replace(/</g, "\\u003c");
  const inject = `<script>window.__PROXY__=${config}</script><script src="/__proxy/client.js"></script>`;

  const rw = new HTMLRewriter()
    .on("head", {
      element(el) {
        if (!ctx.injected) {
          el.prepend(inject, { html: true });
          ctx.injected = true;
        }
      },
    })
    .on("body", {
      element(el) {
        if (!ctx.injected) {
          el.prepend(inject, { html: true });
          ctx.injected = true;
        }
      },
    })
    .on("base[href]", {
      element(el) {
        try {
          ctx.base = new URL(el.getAttribute("href"), ctx.base).href;
        } catch {}
        el.setAttribute("href", proxify(el.getAttribute("href"), target.href));
      },
    })
    .on("[integrity]", { element: (el) => el.removeAttribute("integrity") })
    .on("a[ping]", { element: (el) => el.removeAttribute("ping") })
    .on("[srcset]", { element: (el) => el.setAttribute("srcset", proxifySrcset(el.getAttribute("srcset"), ctx.base)) })
    .on("[style]", { element: (el) => el.setAttribute("style", rewriteCss(el.getAttribute("style"), ctx.base)) })
    .on("meta[http-equiv]", {
      element(el) {
        const eq = (el.getAttribute("http-equiv") || "").toLowerCase();
        if (eq === "content-security-policy") el.remove();
        if (eq === "refresh") {
          const c = el.getAttribute("content") || "";
          el.setAttribute("content", c.replace(/(url\s*=\s*['"]?)([^'";]+)/i, (m, p, u) => p + proxify(u, ctx.base)));
        }
      },
    })
    .on("style", new StyleText(ctx))
    .onDocument({
      end(end) {
        if (!ctx.injected) end.append(inject, { html: true });
      },
    });

  for (const [selector, attr] of Object.entries(URL_ATTRS)) {
    rw.on(selector, {
      element(el) {
        el.setAttribute(attr, proxify(el.getAttribute(attr), ctx.base));
      },
    });
  }
  return rw.transform(res);
}

class StyleText {
  constructor(ctx) {
    this.ctx = ctx;
    this.buf = "";
  }
  text(t) {
    this.buf += t.text;
    if (t.lastInTextNode) {
      t.replace(rewriteCss(this.buf, this.ctx.base), { html: true });
      this.buf = "";
    } else {
      t.remove();
    }
  }
}

// ---------- Cookies ----------
// Each site's cookies are kept in the visitor's browser under the path
// /p/https://that-site/ so sites don't see each other's cookies on requests.

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  if (typeof headers.getAll === "function") return headers.getAll("set-cookie");
  const one = headers.get("set-cookie");
  return one ? [one] : [];
}

function rewriteSetCookie(cookie, target) {
  const parts = cookie.split(";").map((p) => p.trim());
  let nameValue = parts.shift() || "";
  // __Host- cookies must have Path=/, which we can't keep, so rename them.
  if (nameValue.startsWith("__Host-")) nameValue = "__ph__" + nameValue.slice(7);
  let path = "/";
  const attrs = [];
  for (const p of parts) {
    const key = p.split("=")[0].trim().toLowerCase();
    if (key === "domain") continue;
    if (key === "path") {
      path = p.slice(p.indexOf("=") + 1).trim() || "/";
      continue;
    }
    if (key === "partitioned") continue;
    attrs.push(p);
  }
  if (!path.startsWith("/")) path = "/" + path;
  const scoped = PREFIX + target.origin + path;
  return [nameValue, `Path=${scoped}`, ...attrs].join("; ");
}

function outgoingCookies(header) {
  if (!header) return "";
  return header
    .split(";")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => (c.startsWith("__ph__") ? "__Host-" + c.slice(6) : c))
    .join("; ");
}

// ---------- helpers ----------

function html(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex", ...extra },
  });
}

function js(body, extra = {}) {
  return new Response(body, {
    headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache", ...extra },
  });
}
