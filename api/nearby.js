// Nearby restaurants via OpenStreetMap Overpass, asked from the server (no key). Tries 3 mirrors in parallel.
const HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=3600");
  const la = +req.query.lat, lo = +req.query.lon, rad = Math.min(+req.query.r || 8047, 9000);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return res.status(400).json({ error: "Missing location." });
  const dl = rad / 111320, dn = rad / (111320 * Math.cos(la * Math.PI / 180)), bb = `${la - dl},${lo - dn},${la + dl},${lo + dn}`;
  const q = `[out:json][timeout:8];(node["amenity"~"^(restaurant|fast_food)$"]["name"](${bb});way["amenity"~"^(restaurant|fast_food)$"]["name"](${bb}););out center 1000;`;
  const one = async u => {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), 8500);
    try {
      const r = await fetch(u, { method: "POST", signal: c.signal, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "eat-out-app/1.0 (personal nutrition finder)" }, body: "data=" + encodeURIComponent(q) });
      if (!r.ok) throw new Error(u.split("/")[2] + " " + r.status);
      return await r.json();
    } finally { clearTimeout(tm); }
  };
  try {
    const j = await Promise.any(HOSTS.map(one));
    const t = Math.PI / 180, seen = new Map();
    for (const e of j.elements || []) {
      const y = e.lat ?? (e.center && e.center.lat), x = e.lon ?? (e.center && e.center.lon);
      if (y == null || x == null || !e.tags || !e.tags.name) continue;
      const dx = (x - lo) * t * Math.cos(la * t), dy = (y - la) * t, mi = Math.sqrt(dx * dx + dy * dy) * 3958.8;
      if (mi * 1609.34 > rad) continue;
      const k = e.tags.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const addr = [e.tags["addr:housenumber"], e.tags["addr:street"]].filter(Boolean).join(" ");
      if (!seen.has(k) || seen.get(k).mi > mi) seen.set(k, { name: e.tags.name, mi, addr, cuisine: e.tags.cuisine || "", la: y, lo: x });
    }
    res.status(200).json({ items: [...seen.values()].sort((a, b) => a.mi - b.mi), source: "overpass" });
  } catch (e) {
    res.status(502).json({ error: "Map service unreachable", detail: (e.errors ? e.errors.map(x => x.message) : [e.message]).join("; ").slice(0, 200) });
  }
};
