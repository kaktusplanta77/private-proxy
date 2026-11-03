// Proxied URLs look like:  https://your-proxy.workers.dev/p/https://example.com/page?x=1
export const PREFIX = "/p/";

const SKIP = /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;

// Some servers/browsers squash "https://" into "https:/" inside a path. Undo that.
export function fixScheme(s) {
  return s.replace(/^(https?|wss?):\/+/i, (_, p) => p.toLowerCase() + "://");
}

// Turn any URL found on a page into a proxy path, e.g. "/img.png" -> "/p/https://site.com/img.png"
export function proxify(value, base) {
  if (value == null) return value;
  const v = String(value).trim();
  if (!v || SKIP.test(v)) return value;
  if (v.startsWith(PREFIX + "http")) return value; // already proxied
  try {
    const abs = new URL(v, base);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return value;
    return PREFIX + abs.href;
  } catch {
    return value;
  }
}

// Reverse: "/p/https://site.com/x" (or a full proxy URL) -> "https://site.com/x"
export function unproxify(value, proxyOrigin) {
  try {
    const u = new URL(value, proxyOrigin);
    if (u.origin !== proxyOrigin || !u.pathname.startsWith(PREFIX)) return null;
    return new URL(fixScheme(u.pathname.slice(PREFIX.length)) + u.search).href;
  } catch {
    return null;
  }
}

export function proxifySrcset(value, base) {
  return value
    .split(",")
    .map((part) => {
      const [url, ...desc] = part.trim().split(/\s+/);
      return [proxify(url, base), ...desc].join(" ");
    })
    .join(", ");
}

export function rewriteCss(css, base) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url(${q}${proxify(u, base)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import ${q}${proxify(u, base)}${q}`);
}
