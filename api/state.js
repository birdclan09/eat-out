// App state saved on the server so every device matches.
// GET  /api/state?u=me          -> { configured, state }   (state = { fav, meal, goals, prefs, rev, t } or null)
// POST /api/state { u, state, baseRev } -> { ok, rev } | { conflict:true, state } when someone saved since baseRev
// Needs x-edit-key when EDIT_KEY is set (it holds personal data). "u" is the user id, "me" for now, so real accounts can slot in later.
const { readState, writeState } = require("./_state");
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const int = (v, hi) => { const x = Math.round(+v); return Number.isFinite(x) && x > 0 && x <= hi ? x : 0; };
function clean(s) {
  s = isObj(s) ? s : {};
  const fav = isObj(s.fav) ? s.fav : {}, meal = isObj(s.meal) ? s.meal : {}, goals = isObj(s.goals) ? s.goals : {}, prefs = isObj(s.prefs) ? s.prefs : {};
  return {
    fav: { f: isObj(fav.f) ? fav.f : {}, r: isObj(fav.r) ? fav.r : {}, m: isObj(fav.m) ? fav.m : {} },
    meal: { r: String(meal.r || "").slice(0, 120), items: Array.isArray(meal.items) ? meal.items.slice(0, 200) : [] },
    goals: { p: int(goals.p, 500), c: int(goals.c, 10000), cb: int(goals.cb, 1000), f: int(goals.f, 500) },
    prefs: { fo: !!prefs.fo, mo: !!prefs.mo },
  };
}
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.GITHUB_TOKEN) return res.status(200).json({ configured: false, state: null });
  if (process.env.EDIT_KEY && req.headers["x-edit-key"] !== process.env.EDIT_KEY) return res.status(401).json({ error: "Wrong or missing edit key." });
  const b = req.method === "POST" ? (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {}) : {};
  const u = String((req.method === "POST" ? b.u : req.query.u) || "me");
  if (!/^[a-z0-9_-]{1,32}$/.test(u)) return res.status(400).json({ error: "Bad user id." });
  try {
    if (req.method === "GET") { const { data } = await readState(); return res.status(200).json({ configured: true, state: data.users[u] || null }); }
    if (req.method !== "POST") return res.status(405).json({ error: "Use GET or POST." });
    if (JSON.stringify(b.state || {}).length > 250000) return res.status(413).json({ error: "State is too large." });
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, sha } = await readState(), cur = data.users[u];
      if (cur && Number(b.baseRev) !== cur.rev) return res.status(200).json({ ok: false, conflict: true, state: cur });
      const next = { ...clean(b.state), rev: (cur ? cur.rev : 0) + 1, t: new Date().toISOString() };
      data.users[u] = next;
      try { await writeState(data, sha, "App state: " + u); return res.status(200).json({ ok: true, rev: next.rev, t: next.t }); }
      catch (e) { if (e.status === 409 && attempt === 0) continue; throw e; }
    }
  } catch (e) { res.status(502).json({ error: String(e.message || e).slice(0, 200) }); }
};
