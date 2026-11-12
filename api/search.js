// Vercel serverless function. Uses FatSecret when FATSECRET_CLIENT_ID/SECRET are set,
// otherwise falls back to Calorie API (CALORIE_API_KEY). Keys live only in env vars.
const num = v => (typeof v === "number" ? v : v == null || v === "" ? null : Number.isFinite(+v) ? +v : null);
const arr = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

let tokenCache = { token: null, exp: 0 };
async function fsToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
  const id = process.env.FATSECRET_CLIENT_ID, secret = process.env.FATSECRET_CLIENT_SECRET;
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  if (process.env.FATSECRET_SCOPE) body.set("scope", process.env.FATSECRET_SCOPE);
  const r = await fetch("https://oauth.fatsecret.com/connect/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error("FatSecret token request failed"), { detail: JSON.stringify(j).slice(0, 300), status: r.status });
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.token;
}

function fsItem(f) {
  const servings = arr(f.servings && f.servings.serving);
  const usable = servings.filter(s => s.serving_id !== "0");
  const s = usable.find(x => x.is_default === "1") || usable[0] || servings[0];
  if (!s) return null;
  return {
    id: f.food_id, name: f.food_name || "", brand: f.brand_name || "",
    verified: f.food_type === "Brand",
    basis: s.serving_description || "serving",
    n: { cal: num(s.calories), p: num(s.protein), c: num(s.carbohydrate), f: num(s.fat) },
  };
}

async function fatsecret(q, raw) {
  const token = await fsToken();
  const url = `https://platform.fatsecret.com/rest/foods/search/v4?search_expression=${encodeURIComponent(q)}&max_results=50&format=json&flag_default_serving=true`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => null);
  if (raw) return { raw: { status: r.status, body: j && (j.error ? j : { total: j.foods_search && j.foods_search.total_results, first: arr(j.foods_search && j.foods_search.results && j.foods_search.results.food)[0] }) } };
  if (!r.ok || !j || j.error) return { fail: { error: "FatSecret returned an error", detail: JSON.stringify(j && j.error || j).slice(0, 300) } };
  const foods = arr(j.foods_search && j.foods_search.results && j.foods_search.results.food);
  const items = foods.map(fsItem).filter(Boolean).sort((a, b) => Number(b.verified) - Number(a.verified));
  return { items, source: "fatsecret" };
}

function caloriItem(it) {
  const m = (it.meal && it.meal.macros) || {};
  const pick = (...vals) => { for (const v of vals) { const n = num(v); if (n !== null) return n; } return null; };
  return { id: it.id ?? null, name: it.name ?? "", brand: it.brand_name ?? "", verified: !!it.is_verified, basis: it.serving || "100 g",
    n: { cal: pick(it.meal && it.meal.calories, it.calories_100g), p: pick(m.protein, it.protein_100g), c: pick(m.carbs, it.carbs_100g), f: pick(m.fat, it.fat_100g) } };
}
async function calorie(q, raw) {
  const key = process.env.CALORIE_API_KEY;
  if (!key) return { fail: { error: "No nutrition database keys are set on the server." } };
  const r = await fetch(`https://calorieapiadmin.com/api/v1/search/foods?q=${encodeURIComponent(q)}&limit=25`, { headers: { "X-API-Key": key } });
  const j = await r.json().catch(() => null);
  if (raw) return { raw: { status: r.status, first: j && (j.data || [])[0] } };
  if (!r.ok || !j) return { fail: { error: `Calorie API returned ${r.status}` } };
  return { items: (j.data || []).map(caloriItem).sort((a, b) => Number(b.verified) - Number(a.verified)), source: "Calorie API" };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=300");
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({ error: "Type at least two characters." });
  const raw = !!req.query.raw;
  const useFs = process.env.FATSECRET_CLIENT_ID && process.env.FATSECRET_CLIENT_SECRET;
  try {
    const out = useFs ? await fatsecret(q, raw) : await calorie(q, raw);
    if (out.raw) return res.status(200).json({ provider: useFs ? "fatsecret" : "calorie", ...out.raw });
    if (out.fail) return res.status(502).json(out.fail);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e).slice(0, 120), detail: e.detail || String(e.cause && e.cause.code || "").slice(0, 80) });
  }
};
