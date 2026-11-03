const STYLE = `
:root { --bg:#f6f7f9; --card:#fff; --text:#16181d; --muted:#5f6672; --accent:#2f6fed; --border:#dde1e7; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#0f1115; --card:#181b21; --text:#e8eaee; --muted:#9aa1ad; --accent:#6c9bff; --border:#2a2f38; }
}
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
  background:var(--bg); color:var(--text); font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; padding:16px; }
main { width:100%; max-width:620px; }
h1 { font-size:2rem; margin:0 0 .25rem; letter-spacing:-.02em; }
p { color:var(--muted); margin:.25rem 0 1.5rem; }
form { display:flex; gap:8px; }
input { flex:1; min-width:0; padding:14px 16px; font-size:1rem; border-radius:12px; border:1px solid var(--border);
  background:var(--card); color:var(--text); outline:none; }
input:focus { border-color:var(--accent); }
button { padding:14px 20px; font-size:1rem; border:0; border-radius:12px; background:var(--accent); color:#fff; cursor:pointer; }
.note { margin-top:2rem; padding:16px; border:1px solid var(--border); border-radius:12px; background:var(--card); font-size:.9rem; color:var(--muted); }
.note b { color:var(--text); }
.links { margin-top:1rem; font-size:.9rem; }
a { color:var(--accent); }
`;

export const HOME_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Private Proxy</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <h1>Private Proxy</h1>
  <p>Browse any site through this proxy. Nothing you do here is saved on the server.</p>
  <form id="f">
    <input id="q" autofocus autocomplete="off" placeholder="Search or type a URL" aria-label="Search or type a URL">
    <button type="submit">Go</button>
  </form>
  <div class="note">
    <b>How your data is handled:</b> the server keeps no logs, no database and no files.
    Your logins live only as cookies in <i>your</i> browser. The code is open source so anyone can check it.
    <br><br>
    <b>Be careful:</b> every site you open here shares one browser origin, so a bad site opened through
    the proxy could read data that other sites left in your browser. Use "Clear my data" after logging in to anything important.
  </div>
  <div class="links"><a href="/__proxy/clear">Clear my data</a></div>
</main>
<script>
if (navigator.serviceWorker) navigator.serviceWorker.register("/__proxy/sw.js", { scope: "/" }).catch(function(){});
document.getElementById("f").addEventListener("submit", function (e) {
  e.preventDefault();
  var v = document.getElementById("q").value.trim();
  if (!v) return;
  var url;
  if (/^https?:\\/\\//i.test(v)) url = v;
  else if (!/\\s/.test(v) && /^[^\\s]+\\.[a-z]{2,}(\\/|:|$)/i.test(v)) url = "https://" + v;
  else url = "https://duckduckgo.com/html/?q=" + encodeURIComponent(v);
  location.href = "/p/" + url;
});
</script>
</body>
</html>`;

export function errorPage(title, detail) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Proxy error</title><style>${STYLE}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(detail)}</p><div class="links"><a href="/">Back to start</a></div></main></body></html>`;
}

export const CLEARED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Data cleared</title><style>${STYLE}</style></head>
<body><main><h1>All cleared</h1><p>Cookies, storage and cache for this proxy were removed from your browser.</p>
<div class="links"><a href="/">Back to start</a></div></main></body></html>`;
