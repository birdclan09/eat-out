// Lists restaurants near a point using OpenStreetMap (Overpass). No key needed.
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=3600");
  const la = +req.query.lat, lo = +req.query.lon, rad = Math.min(+req.query.r || 5000, 8000);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return res.status(400).json({ error: "Missing location." });
  const q = `[out:json][timeout:20];nwr["amenity"~"^(restaurant|fast_food)$"]["name"](around:${rad},${la},${lo});out center 300;`;
  try {
    const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q) });
    if (!r.ok) return res.status(502).json({ error: `Map service returned ${r.status}` });
    const j = await r.json();
    const t = Math.PI / 180, seen = new Map();
    for (const e of j.elements || []) {
      const y = e.lat ?? (e.center && e.center.lat), x = e.lon ?? (e.center && e.center.lon);
      if (y == null || x == null || !e.tags || !e.tags.name) continue;
      const dx = (x - lo) * t * Math.cos(la * t), dy = (y - la) * t, mi = Math.sqrt(dx * dx + dy * dy) * 3958.8;
      const key = e.tags.name.toLowerCase();
      const addr = [e.tags["addr:housenumber"], e.tags["addr:street"]].filter(Boolean).join(" ");
      if (!seen.has(key) || seen.get(key).mi > mi) seen.set(key, { name: e.tags.name, mi: Math.round(mi * 10) / 10, addr, cuisine: e.tags.cuisine || "" });
    }
    res.status(200).json({ items: [...seen.values()].sort((a, b) => a.mi - b.mi).slice(0, 60) });
  } catch (e) {
    res.status(502).json({ error: "Could not reach the map service.", detail: String(e.message || e).slice(0, 80) });
  }
};
