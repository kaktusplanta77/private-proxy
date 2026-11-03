// This runs inside every proxied page. It catches URLs that JavaScript creates
// on the fly (fetch, XHR, WebSockets, new elements...) and sends them through the proxy.
// It must stay self-contained: it is turned into a string with .toString().
function clientMain() {
  if (window.__proxyClientLoaded) return;
  window.__proxyClientLoaded = true;

  const PREFIX = "/p/";
  const ORIGIN = location.origin;
  const SKIP = /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;

  function targetUrl() {
    const p = location.pathname;
    if (!p.startsWith(PREFIX)) return (window.__PROXY__ && window.__PROXY__.url) || null;
    return p.slice(PREFIX.length).replace(/^(https?):\/+/i, "$1://") + location.search;
  }

  function rw(value) {
    if (value == null) return value;
    if (typeof value !== "string") value = String(value);
    const v = value.trim();
    if (!v || SKIP.test(v)) return value;
    if (v.startsWith(PREFIX + "http") || v.startsWith(ORIGIN + PREFIX) || v.startsWith("/__proxy/")) return value;
    const base = targetUrl();
    if (!base) return value;
    try {
      const abs = new URL(v, base);
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return value;
      return ORIGIN + PREFIX + abs.href;
    } catch {
      return value;
    }
  }

  function rwWs(value) {
    try {
      const abs = new URL(String(value), targetUrl());
      if (abs.protocol === "ws:") abs.protocol = "http:";
      if (abs.protocol === "wss:") abs.protocol = "https:";
      return ORIGIN.replace(/^http/, "ws") + PREFIX + abs.href;
    } catch {
      return value;
    }
  }

  function rwSrcset(value) {
    return String(value)
      .split(",")
      .map((part) => {
        const [url, ...d] = part.trim().split(/\s+/);
        return [rw(url), ...d].join(" ");
      })
      .join(", ");
  }

  // Register our service worker (catches anything the patches below miss).
  const swContainer = navigator.serviceWorker;
  if (swContainer) {
    const realRegister = swContainer.register.bind(swContainer);
    realRegister("/__proxy/sw.js", { scope: "/" }).catch(() => {});
    // Stop proxied sites from installing their own service workers.
    swContainer.register = () => Promise.reject(new DOMException("Blocked by proxy", "SecurityError"));
  }

  // document.cookie: keep each site's cookies under /p/https://that-site/
  // so one site can't send its cookies to another.
  const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
  if (cookieDesc && cookieDesc.set) {
    Object.defineProperty(Document.prototype, "cookie", {
      ...cookieDesc,
      get() {
        return cookieDesc.get.call(this).replace(/(^|;\s*)__ph__/g, "$1__Host-");
      },
      set(v) {
        let site;
        try {
          site = new URL(targetUrl()).origin;
        } catch {
          return;
        }
        const parts = String(v).split(";");
        let nameValue = parts.shift().trim();
        if (nameValue.startsWith("__Host-")) nameValue = "__ph__" + nameValue.slice(7);
        let path = "/";
        const attrs = [];
        for (const p of parts) {
          const key = p.split("=")[0].trim().toLowerCase();
          if (key === "domain" || key === "partitioned") continue;
          if (key === "path") {
            path = p.slice(p.indexOf("=") + 1).trim() || "/";
            continue;
          }
          attrs.push(p.trim());
        }
        if (!path.startsWith("/")) path = "/" + path;
        cookieDesc.set.call(this, [nameValue, "Path=" + PREFIX + site + path, ...attrs].join("; "));
      },
    });
  }

  // fetch()
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    if (input instanceof Request) return realFetch.call(this, new Request(rw(input.url), input), init);
    return realFetch.call(this, rw(input), init);
  };

  // XMLHttpRequest
  const realOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return realOpen.call(this, method, rw(url), ...rest);
  };

  // WebSocket / EventSource / Worker
  const RealWS = window.WebSocket;
  if (RealWS) {
    window.WebSocket = class extends RealWS {
      constructor(url, protocols) {
        super(rwWs(url), protocols);
      }
    };
  }
  const RealES = window.EventSource;
  if (RealES) {
    window.EventSource = class extends RealES {
      constructor(url, opts) {
        super(rw(url), opts);
      }
    };
  }
  const RealWorker = window.Worker;
  if (RealWorker) {
    window.Worker = class extends RealWorker {
      constructor(url, opts) {
        super(rw(url), opts);
      }
    };
  }

  // history, window.open, sendBeacon
  for (const name of ["pushState", "replaceState"]) {
    const real = history[name];
    history[name] = function (state, title, url) {
      return real.call(this, state, title, url == null ? url : rw(url));
    };
  }
  const realWindowOpen = window.open;
  window.open = function (url, ...rest) {
    return realWindowOpen.call(this, url ? rw(url) : url, ...rest);
  };
  if (navigator.sendBeacon) {
    const realBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => realBeacon(rw(url), data);
  }

  // Element properties like img.src = "...", a.href = "..."
  const PROPS = [
    ["HTMLAnchorElement", "href"], ["HTMLAreaElement", "href"], ["HTMLLinkElement", "href"],
    ["HTMLImageElement", "src"], ["HTMLScriptElement", "src"], ["HTMLIFrameElement", "src"],
    ["HTMLSourceElement", "src"], ["HTMLMediaElement", "src"], ["HTMLVideoElement", "poster"],
    ["HTMLTrackElement", "src"], ["HTMLEmbedElement", "src"], ["HTMLObjectElement", "data"],
    ["HTMLFormElement", "action"], ["HTMLInputElement", "src"], ["HTMLInputElement", "formAction"],
    ["HTMLButtonElement", "formAction"],
  ];
  for (const [cls, prop] of PROPS) {
    const C = window[cls];
    if (!C) continue;
    const desc = Object.getOwnPropertyDescriptor(C.prototype, prop);
    if (!desc || !desc.set) continue;
    Object.defineProperty(C.prototype, prop, {
      ...desc,
      set(v) {
        desc.set.call(this, rw(v));
      },
    });
  }
  for (const cls of ["HTMLImageElement", "HTMLSourceElement"]) {
    const C = window[cls];
    const desc = C && Object.getOwnPropertyDescriptor(C.prototype, "srcset");
    if (!desc || !desc.set) continue;
    Object.defineProperty(C.prototype, "srcset", {
      ...desc,
      set(v) {
        desc.set.call(this, rwSrcset(v));
      },
    });
  }

  // setAttribute("src", ...) etc.
  const URL_ATTRS = new Set(["href", "src", "action", "formaction", "poster", "data"]);
  const realSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const n = String(name).toLowerCase();
    if (URL_ATTRS.has(n) && !(this instanceof SVGElement)) value = rw(value);
    else if (n === "srcset") value = rwSrcset(value);
    else if (n === "integrity") return;
    return realSetAttr.call(this, name, value);
  };

  // Elements added with innerHTML etc.
  function fixElement(el) {
    if (!(el instanceof HTMLElement)) return;
    for (const a of URL_ATTRS) {
      const v = el.getAttribute(a);
      if (v != null) {
        const nv = rw(v);
        if (nv !== v) realSetAttr.call(el, a, nv);
      }
    }
    const ss = el.getAttribute("srcset");
    if (ss) {
      const nv = rwSrcset(ss);
      if (nv !== ss) realSetAttr.call(el, "srcset", nv);
    }
    if (el.hasAttribute("integrity")) el.removeAttribute("integrity");
  }
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes") fixElement(r.target);
      for (const n of r.addedNodes || []) {
        if (n.nodeType !== 1) continue;
        fixElement(n);
        if (n.querySelectorAll) n.querySelectorAll("[href],[src],[action],[srcset],[poster]").forEach(fixElement);
      }
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["href", "src", "action", "srcset", "poster", "formaction"],
  });

  // Last-chance fixes for clicks and form submits.
  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest && e.target.closest("a[href]");
    if (a) fixElement(a);
  }, true);
  document.addEventListener("submit", (e) => {
    if (e.target instanceof HTMLFormElement) fixElement(e.target);
  }, true);
}

// The bundler may add calls to a __name() helper; define it so the script runs in the browser.
export const CLIENT_JS = `(function(){var __name=function(f){return f};(${clientMain.toString()})();})();`;
