// POST {key} -> sets a long-lived login cookie. POST {logout:true} clears it. GET -> {ok} tells if this device is logged in.
const A = require("./_auth");
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "GET") return res.status(200).json({ ok: A.ok(req), needsKey: !!process.env.EDIT_KEY });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (b.logout) { A.clearCookie(res); return res.status(200).json({ ok: false }); }
  if (!A.ok({ headers: { "x-edit-key": String(b.key || "") } })) return res.status(401).json({ error: "Wrong or missing edit key." });
  A.setCookie(res);
  return res.status(200).json({ ok: true });
};
