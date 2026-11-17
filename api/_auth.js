// Shared edit-key check. Accepts the x-edit-key header OR a long-lived server-set cookie (survives iOS Safari's 7-day storage purge).
const crypto = require("crypto");
const tok = () => crypto.createHmac("sha256", String(process.env.EDIT_KEY || "")).update("eat-out-login-v1").digest("hex");
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookie = (req) => { const m = /(?:^|;\s*)eo_auth=([a-f0-9]+)/.exec(req.headers.cookie || ""); return m ? m[1] : ""; };
function ok(req) {
  if (!process.env.EDIT_KEY) return true;
  const h = req.headers["x-edit-key"];
  if (h && eq(h, process.env.EDIT_KEY)) return true;
  const c = cookie(req);
  return !!c && eq(c, tok());
}
function setCookie(res) {
  res.setHeader("Set-Cookie", `eo_auth=${tok()}; Max-Age=34560000; Path=/; HttpOnly; Secure; SameSite=Lax`);
}
function clearCookie(res) {
  res.setHeader("Set-Cookie", "eo_auth=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax");
}
module.exports = { ok, setCookie, clearCookie };
