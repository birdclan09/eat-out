// Turns a town or address into coordinates so the map can move there.
// Uses Geoapify (same GEOAPIFY_KEY as places.js); falls back to OpenStreetMap Nominatim.
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=86400");
  const q = String(req.query.q || "").trim().slice(0, 120);
  if (q.length < 2) return res.status(400).json({ error: "Type a town or address." });
  const la = +req.query.lat, lo = +req.query.lon, near = Number.isFinite(la) && Number.isFinite(lo);
  const key = process.env.GEOAPIFY_KEY;
  const short = s => String(s || "").split(",").slice(0, 2).join(",").trim();
  if (key) {
    try {
      const u = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(q)}&limit=1&format=json${near ? `&bias=proximity:${lo},${la}` : ""}&apiKey=${key}`;
      const r = await fetch(u);
      const j = await r.json().catch(() => null);
      const p = r.ok && j && j.results && j.results[0];
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) return res.status(200).json({ la: p.lat, lo: p.lon, name: short(p.formatted) || q, source: "geoapify" });
    } catch (e) { /* fall through to Nominatim */ }
  }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1`, { headers: { "User-Agent": "eat-out-app/1.0 (personal nutrition finder)", Accept: "application/json" } });
    const j = await r.json().catch(() => null);
    const p = r.ok && Array.isArray(j) && j[0];
    if (p && Number.isFinite(+p.lat) && Number.isFinite(+p.lon)) return res.status(200).json({ la: +p.lat, lo: +p.lon, name: short(p.display_name) || q, source: "nominatim" });
    return res.status(404).json({ error: "No place found for that." });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the place lookup.", detail: String(e.message || e).slice(0, 80) });
  }
};
