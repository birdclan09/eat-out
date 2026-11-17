// Finds the nearest restaurant matching a name (OpenStreetMap via Overpass, asked from the server, no key).
// GET ?name=Five%20Guys&lat=..&lon=..  ->  { found, place:{name,addr,mi,la,lo,hours,phone,website,cuisine}, others:[...], count }
const HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=3600");
  const name = String(req.query.name || "").trim().slice(0, 60), la = +req.query.lat, lo = +req.query.lon;
  if (name.length < 2) return res.status(400).json({ error: "Missing restaurant name." });
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return res.status(400).json({ error: "Missing location." });
  const rad = Math.min(+req.query.r || 50000, 80000), dl = rad / 111320, dn = rad / (111320 * Math.cos(la * Math.PI / 180));
  const bb = `${la - dl},${lo - dn},${la + dl},${lo + dn}`;
  // letters and digits match as typed; any other character (apostrophe, dash, ampersand) matches zero or one character
  const rx = name.replace(/[^A-Za-z0-9 ]/g, ".?");
  const q = `[out:json][timeout:12];nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["name"~"${rx}",i](${bb});out center 300;`;
  const one = async u => {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), 13000);
    try {
      const r = await fetch(u, { method: "POST", signal: c.signal, headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "eat-out-app/1.0 (personal nutrition finder)" }, body: "data=" + encodeURIComponent(q) });
      if (!r.ok) throw new Error(u.split("/")[2] + " " + r.status);
      return await r.json();
    } finally { clearTimeout(tm); }
  };
  try {
    const j = await Promise.any(HOSTS.map(one)), t = Math.PI / 180, list = [];
    for (const e of j.elements || []) {
      const y = e.lat ?? (e.center && e.center.lat), x = e.lon ?? (e.center && e.center.lon), g = e.tags || {};
      if (y == null || x == null || !g.name) continue;
      const dx = (x - lo) * t * Math.cos(la * t), dy = (y - la) * t, mi = Math.sqrt(dx * dx + dy * dy) * 3958.8;
      const street = [g["addr:housenumber"], g["addr:street"]].filter(Boolean).join(" "), st = [g["addr:state"], g["addr:postcode"]].filter(Boolean).join(" ");
      const addr = g["addr:full"] || [street, g["addr:city"], st].filter(Boolean).join(", ");
      list.push({ name: g.name, addr, mi, la: y, lo: x, hours: g.opening_hours || "", phone: g.phone || g["contact:phone"] || "", website: g.website || g["contact:website"] || "", cuisine: g.cuisine || "" });
    }
    list.sort((a, b) => a.mi - b.mi);
    if (!list.length) return res.status(200).json({ found: false, count: 0 });
    res.status(200).json({ found: true, place: list[0], others: list.slice(1, 4).map(p => ({ name: p.name, addr: p.addr, mi: p.mi })), count: list.length, source: "openstreetmap" });
  } catch (e) {
    res.status(502).json({ error: "Map service unreachable", detail: (e.errors ? e.errors.map(x => x.message) : [e.message]).join("; ").slice(0, 200) });
  }
};
