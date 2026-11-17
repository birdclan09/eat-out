// Finds the nearest restaurant matching a name. Geoapify first (GEOAPIFY_KEY), OpenStreetMap Overpass as the fallback.
// GET ?name=Five%20Guys&lat=..&lon=..  ->  { found, place:{name,addr,mi,la,lo,hours,phone,website,cuisine}, others:[...], count }
const HOSTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=3600");
  const name = String(req.query.name || "").trim().slice(0, 60), la = +req.query.lat, lo = +req.query.lon;
  if (name.length < 2) return res.status(400).json({ error: "Missing restaurant name." });
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return res.status(400).json({ error: "Missing location." });
  const rad = Math.min(+req.query.r || 50000, 80000), t = Math.PI / 180, key = process.env.GEOAPIFY_KEY;
  const miTo = (y, x) => Math.sqrt(((x - lo) * t * Math.cos(la * t)) ** 2 + ((y - la) * t) ** 2) * 3958.8;
  const sq = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const pack = (list, source) => {
    list.sort((a, b) => a.mi - b.mi);
    if (!list.length) return { found: false, count: 0, source };
    return { found: true, place: list[0], others: list.slice(1, 4).map(p => ({ name: p.name, addr: p.addr, mi: p.mi })), count: list.length, source };
  };
  const timed = async (u, opt, ms) => {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), ms);
    try { return await fetch(u, { ...opt, signal: c.signal }); } finally { clearTimeout(tm); }
  };

  // 1) Geoapify (key from env): finds the places by name quickly; Place Details then adds hours, phone and website when OpenStreetMap has them.
  const viaGeoapify = async () => {
    if (!key) return null;
    const u = `https://api.geoapify.com/v2/places?categories=catering.restaurant,catering.fast_food,catering.cafe&name=${encodeURIComponent(name)}&filter=circle:${lo},${la},${rad}&bias=proximity:${lo},${la}&limit=50&apiKey=${key}`;
    const r = await timed(u, {}, 8000), j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error("Geoapify places " + r.status);
    const words = sq(name).split(/\s+/).filter(Boolean), list = [];
    for (const f of j.features || []) {
      const p = f.properties || {};
      if (!p.name || p.lat == null || p.lon == null || !words.every(w => sq(p.name).includes(w))) continue;
      list.push({ name: p.name, addr: String(p.address_line2 || "").replace(/,\s*United States( of America)?$/i, ""), mi: miTo(p.lat, p.lon), la: p.lat, lo: p.lon, hours: "", phone: "", website: "", cuisine: "", id: p.place_id });
    }
    if (!list.length) return null;
    list.sort((a, b) => a.mi - b.mi);
    const top = list[0];
    if (top.id) {
      try {
        const d = await timed(`https://api.geoapify.com/v2/place-details?id=${encodeURIComponent(top.id)}&features=details&apiKey=${key}`, {}, 6000), dj = await d.json().catch(() => null);
        if (d.ok && dj) for (const f of dj.features || []) {
          const p = f.properties || {};
          top.hours = top.hours || p.opening_hours || ""; top.phone = top.phone || (p.contact && p.contact.phone) || ""; top.website = top.website || p.website || "";
        }
      } catch (e) { /* details are optional */ }
    }
    list.forEach(p => delete p.id);
    return pack(list, "geoapify");
  };

  // 2) OpenStreetMap via Overpass (no key), used when Geoapify is missing, fails or finds nothing.
  const viaOverpass = async () => {
    const dl = rad / 111320, dn = rad / (111320 * Math.cos(la * t)), bb = `${la - dl},${lo - dn},${la + dl},${lo + dn}`;
    // letters and digits match as typed; any other character (apostrophe, dash, ampersand) matches zero or one character
    const rx = name.replace(/[^A-Za-z0-9 ]/g, ".?");
    const q = `[out:json][timeout:12];nwr["amenity"~"^(restaurant|fast_food|cafe)$"]["name"~"${rx}",i](${bb});out center 300;`;
    const one = async u => {
      const r = await timed(u, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "eat-out-app/1.0 (personal nutrition finder)" }, body: "data=" + encodeURIComponent(q) }, 13000);
      if (!r.ok) throw new Error(u.split("/")[2] + " " + r.status);
      return await r.json();
    };
    const j = await Promise.any(HOSTS.map(one)), list = [];
    for (const e of j.elements || []) {
      const y = e.lat ?? (e.center && e.center.lat), x = e.lon ?? (e.center && e.center.lon), g = e.tags || {};
      if (y == null || x == null || !g.name) continue;
      const street = [g["addr:housenumber"], g["addr:street"]].filter(Boolean).join(" "), st = [g["addr:state"], g["addr:postcode"]].filter(Boolean).join(" ");
      list.push({ name: g.name, addr: g["addr:full"] || [street, g["addr:city"], st].filter(Boolean).join(", "), mi: miTo(y, x), la: y, lo: x, hours: g.opening_hours || "", phone: g.phone || g["contact:phone"] || "", website: g.website || g["contact:website"] || "", cuisine: g.cuisine || "" });
    }
    return pack(list, "openstreetmap");
  };

  const errs = [];
  let out = null;
  try { out = await viaGeoapify(); } catch (e) { errs.push(String(e.message || e)); }
  if (!out) { try { out = await viaOverpass(); } catch (e) { errs.push(...(e.errors ? e.errors.map(x => x.message) : [e.message])); } }
  if (!out) { res.setHeader("Cache-Control", "no-store"); return res.status(502).json({ error: "Place lookup unreachable", detail: errs.join("; ").slice(0, 200) }); }
  res.status(200).json(out);
};
