// Nearby restaurants via Geoapify Places (OpenStreetMap data). Key stays in env var GEOAPIFY_KEY.
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=3600");
  const key = process.env.GEOAPIFY_KEY;
  if (!key) return res.status(501).json({ error: "GEOAPIFY_KEY not set" });
  const la = +req.query.lat, lo = +req.query.lon, rad = Math.min(+req.query.r || 8047, 10000);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return res.status(400).json({ error: "Missing location." });
  try {
    const url = `https://api.geoapify.com/v2/places?categories=catering.restaurant,catering.fast_food&filter=circle:${lo},${la},${rad}&bias=proximity:${lo},${la}&limit=500&apiKey=${key}`;
    const r = await fetch(url);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return res.status(502).json({ error: `Places service returned ${r.status}`, detail: JSON.stringify(j).slice(0, 200) });
    const t = Math.PI / 180, seen = new Map();
    for (const f of j.features || []) {
      const p = f.properties || {};
      if (!p.name) continue;
      const mi = (p.distance != null ? p.distance : Math.sqrt(((p.lon - lo) * t * Math.cos(la * t)) ** 2 + ((p.lat - la) * t) ** 2) * 6371000) / 1609.34;
      const k = p.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!seen.has(k) || seen.get(k).mi > mi) seen.set(k, { name: p.name, mi, addr: p.address_line2 ? p.address_line2.split(",")[0] : "", cuisine: "", la: p.lat, lo: p.lon });
    }
    res.status(200).json({ items: [...seen.values()].sort((a, b) => a.mi - b.mi), source: "geoapify" });
  } catch (e) {
    res.status(502).json({ error: "Could not reach the places service.", detail: String(e.message || e).slice(0, 80) });
  }
};
