// Saved/supplemental menus, stored as data/menus.json in the GitHub repo.
// GET  -> { menus, configured }
// POST -> { action:"save", name, items, source? } or { action:"delete", name }  (needs x-edit-key if EDIT_KEY is set)
const { readMenus, writeMenus } = require("./_gh");
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const n = v => { const x = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(x) && x >= 0 ? Math.round(x * 10) / 10 : null; };
function clean(items) {
  return (Array.isArray(items) ? items : []).slice(0, 400).map(i => ({
    n: String(i.n || i.name || "").trim().slice(0, 120), c: String(i.c || i.category || "").trim().slice(0, 60),
    cal: n(i.cal ?? i.calories), p: n(i.p ?? i.protein), cb: n(i.cb ?? i.carbs), f: n(i.f ?? i.fat), b: String(i.b || i.serving || "").trim().slice(0, 60),
  })).filter(i => i.n && i.cal > 0 && i.p != null);
}
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.GITHUB_TOKEN) return req.method === "GET" ? res.status(200).json({ menus: {}, configured: false }) : res.status(501).json({ error: "GITHUB_TOKEN is not set on the server." });
  try {
    if (req.method === "GET") { const { menus } = await readMenus(); return res.status(200).json({ menus, configured: true, locked: !!process.env.EDIT_KEY }); }
    if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST." });
    if (process.env.EDIT_KEY && req.headers["x-edit-key"] !== process.env.EDIT_KEY) return res.status(401).json({ error: "Wrong or missing edit key." });
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const name = String(b.name || "").trim().slice(0, 100), id = norm(name);
    if (!id) return res.status(400).json({ error: "Missing restaurant name." });
    for (let attempt = 0; attempt < 2; attempt++) {
      const { menus, sha } = await readMenus();
      if (b.action === "delete") delete menus[id];
      else if (b.action === "save") {
        const items = clean(b.items);
        if (!items.length) return res.status(400).json({ error: "No valid items (each needs a name, calories and protein)." });
        const cur = menus[id] || { name, items: [] };
        const src = b.source && b.source.url ? { url: String(b.source.url).slice(0, 500), kind: String(b.source.kind || "link").slice(0, 20), t: new Date().toISOString(), official: !!b.source.official } : null;
        // replace=true swaps in a fresh import from the source; otherwise append (skip same-name duplicates)
        // v:1 = imported from the restaurant's own site, v:2 = imported from a third-party site; hand-typed and file/photo additions stay 0
        items.forEach(i => { i.v = src ? (src.official ? 1 : 2) : 0; });
        const keep = b.replace ? [] : cur.items.filter(o => !items.some(i => norm(i.n) === norm(o.n)));
        const now = new Date().toISOString();
        // updated = last save of any kind; log = the 10 most recent saves (when, how many items, how)
        // check = how the import compared with its source in the app (sent only with imports): ok, items compared, held back, kept anyway
        const ci = x => Math.max(0, Math.min(9999, parseInt(x, 10) || 0));
        const ck = b.check && typeof b.check === "object" ? { ok: !!b.check.ok, n: ci(b.check.n), held: ci(b.check.held), kept: ci(b.check.kept), t: now } : null;
        const log = [{ t: now, n: items.length, how: src ? src.kind : "manual", replace: !!b.replace, ...(ck ? { check: ck } : {}) }].concat(cur.log || []).slice(0, 10);
        menus[id] = { name: cur.name || name, items: keep.concat(items).slice(0, 600), source: src || cur.source || null, updated: now, log, ...((ck || cur.check) ? { check: ck || cur.check } : {}) };
      } else return res.status(400).json({ error: "Unknown action." });
      try { await writeMenus(menus, sha, `Menu data: ${b.action} ${name}`); return res.status(200).json({ ok: true, menu: menus[id] || null }); }
      catch (e) { if (e.status === 409 && attempt === 0) continue; throw e; }
    }
  } catch (e) { return res.status(502).json({ error: String(e.message || e).slice(0, 200) }); }
};
