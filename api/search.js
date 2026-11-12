// Vercel serverless function: looks up foods in Calorie API.
// Key lives in the CALORIE_API_KEY environment variable (never in the repo).
const BASES = process.env.CALORIE_API_BASE ? [process.env.CALORIE_API_BASE] : ["https://calorieapiadmin.com", "https://api.calorieapi.com", "https://calorieapi.com"];

const num = v => (typeof v === "number" ? v : v == null || v === "" ? null : Number.isFinite(+v) ? +v : null);

function normalize(it) {
  const m = (it.meal && it.meal.macros) || {};
  const pick = (...vals) => { for (const v of vals) { const n = num(v); if (n !== null) return n; } return null; };
  return {
    id: it.id ?? null,
    name: it.name ?? "",
    brand: it.brand_name ?? "",
    verified: !!it.is_verified,
    basis: it.serving || (it.default_portion && it.default_portion.label) || "100 g",
    n: {
      cal: pick(it.meal && it.meal.calories, it.calories_100g),
      p: pick(m.protein, it.protein_100g),
      c: pick(m.carbs, it.carbs_100g),
      f: pick(m.fat, it.fat_100g),
    },
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=600");
  const key = process.env.CALORIE_API_KEY;
  if (!key) return res.status(500).json({ error: "CALORIE_API_KEY is not set on the server." });
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(400).json({ error: "Type at least two characters." });
  const errs = [];
  for (const base of BASES) {
    const url = `${base}/api/v1/search/foods?q=${encodeURIComponent(q)}&limit=25`;
    try {
      const up = await fetch(url, { headers: { "X-API-Key": key } });
      const text = await up.text();
      let json; try { json = JSON.parse(text); } catch { json = null; }
      if (req.query.raw) {
        const out = { url, status: up.status, firstItem: json && (Array.isArray(json) ? json[0] : (json.data || json.results || json.foods || [])[0]), keys: json && Object.keys(json) };
        const id = out.firstItem && (out.firstItem.id ?? out.firstItem.food_id);
        if (id != null) { try { const d = await fetch(`${base}/api/v1/foods/${id}`, { headers: { "X-API-Key": key } }); const dt = await d.text(); out.detailStatus = d.status; out.detail = dt.slice(0, 1500); } catch (e) { out.detail = String(e); } }
        return res.status(200).json(out);
      }
      if (json === null) { errs.push(`${base}: not JSON (${up.status})`); continue; }
      if (!up.ok) return res.status(502).json({ error: `Calorie API returned ${up.status}`, detail: (json.detail || json.error || "").toString().slice(0, 300) });
      const list = Array.isArray(json) ? json : json.data || json.results || json.foods || [];
      const items = list.map(normalize).sort((x, y) => Number(y.verified) - Number(x.verified));
      return res.status(200).json({ items, source: "Calorie API" });
    } catch (e) {
      errs.push(`${base}: ${String(e.cause && e.cause.code || e.message || e).slice(0, 80)}`);
    }
  }
  return res.status(502).json({ error: "Could not reach Calorie API", detail: errs.join(" | ") });
};
