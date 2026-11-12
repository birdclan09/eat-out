// Vercel serverless function: looks up foods in Calorie API.
// Key lives in the CALORIE_API_KEY environment variable (never in the repo).
const BASE = process.env.CALORIE_API_BASE || "https://api.calorieapi.com";

const num = v => (typeof v === "number" ? v : v == null || v === "" ? null : Number.isFinite(+v) ? +v : null);

function normalize(it) {
  const per100 = it.nutrition_per_100g || {};
  const perServ = it.nutrition_per_serving || null;
  const pick = (...vals) => { for (const v of vals) { const n = num(v); if (n !== null) return n; } return null; };
  return {
    id: it.id ?? it.food_id ?? null,
    name: it.name ?? it.food_name ?? "",
    brand: it.brand_name ?? it.brand ?? "",
    per100: {
      cal: pick(it.calories, it.energy_kcal, per100.energy_kcal, per100.calories),
      p: pick(it.protein_g, per100.protein_g),
      c: pick(it.carbohydrates_g, per100.carbohydrates_g),
      f: pick(it.fat_g, per100.fat_g),
    },
    serving: perServ ? {
      cal: pick(perServ.energy_kcal, perServ.calories),
      p: pick(perServ.protein_g),
      c: pick(perServ.carbohydrates_g),
      f: pick(perServ.fat_g),
    } : null,
    servingLabel: it.serving_size ?? it.serving_label ?? (it.serving && it.serving.label) ?? null,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=600");
  const key = process.env.CALORIE_API_KEY;
  if (!key) return res.status(500).json({ error: "CALORIE_API_KEY is not set on the server." });
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({ error: "Type at least two characters." });
  const url = `${BASE}/api/v1/search/foods?q=${encodeURIComponent(q)}&limit=25`;
  try {
    const up = await fetch(url, { headers: { "X-API-Key": key } });
    const text = await up.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    if (req.query.raw) return res.status(200).json({ url: url.replace(key, "***"), status: up.status, body: json ?? text.slice(0, 2000) });
    if (!up.ok) return res.status(502).json({ error: `Calorie API returned ${up.status}`, detail: (json && (json.detail || json.error)) || text.slice(0, 300) });
    const list = Array.isArray(json) ? json : json.data || json.results || json.foods || [];
    return res.status(200).json({ items: list.map(normalize), source: "Calorie API" });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach Calorie API", detail: String(e).slice(0, 200) });
  }
};
