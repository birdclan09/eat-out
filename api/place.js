const gridFix = require("./_grid");
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
    return { found: true, place: list[0], others: list.slice(1, 4).map(p => ({ name: p.name, addr: p.addr, mi: p.mi, la: p.la, lo: p.lo })), count: list.length, source };
  };
  const timed = async (u, opt, ms) => {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), ms);
    try { return await fetch(u, { ...opt, signal: c.signal }); } finally { clearTimeout(tm); }
  };

  // Address text. Geoapify's tidied address_line2 can drop a Utah-style direction ("5639 7800 South" instead of "5639 West 7800 South"), so also build one from the raw OpenStreetMap tags and from the formatted line, expand abbreviations (W -> West), and keep the most complete version.
  const DIR = { N: "North", S: "South", E: "East", W: "West" };
  const expand = a => String(a || "").replace(/\b([NSEW])\.?(?=\s+\d)/g, (_, d) => DIR[d]).replace(/(\d\s+)([NSEW])\.?(?=\s*(,|$))/g, (_, n, d) => n + DIR[d]);
  const bestAddr = p => {
    const clean = a => expand(String(a || "").replace(/,\s*United States( of America)?$/i, "").trim());
    const raw = (p.datasource && p.datasource.raw) || {}, cands = [clean(p.address_line2)];
    const hn = raw["addr:housenumber"] || p.housenumber || "";
    if (raw["addr:street"] && hn) {
      const pre = raw["addr:street:prefix"] || raw["addr:street:direction"] || "", suf = raw["addr:street:suffix"] || "";
      let st = raw["addr:street"];
      if (pre && !new RegExp("^" + pre.replace(/[^A-Za-z]/g, ""), "i").test(st)) st = pre + " " + st;
      if (suf && !new RegExp(suf.replace(/[^A-Za-z]/g, "") + "$", "i").test(st)) st = st + " " + suf;
      const tail = String(p.address_line2 || "").split(",").slice(1).join(",");
      cands.push(clean(hn + " " + st + (tail ? "," + tail : "")));
    }
    const seg = String(p.formatted || "").split(",").map(x => x.trim());
    const i = seg.findIndex(x => hn && x.startsWith(hn + " "));
    if (i >= 0) cands.push(clean(seg.slice(i).join(", ")));
    // street part (before the first comma): the longest wins, since a dropped direction makes it shorter
    return cands.filter(Boolean).sort((a, b) => a.split(",")[0].length - b.split(",")[0].length).pop() || "";
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
      list.push({ name: p.name, addr: gridFix(bestAddr(p), p.lat, p.lon), mi: miTo(p.lat, p.lon), la: p.lat, lo: p.lon, hours: "", phone: "", website: "", cuisine: "", id: p.place_id });
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
      list.push({ name: g.name, addr: gridFix(g["addr:full"] || [street, g["addr:city"], st].filter(Boolean).join(", "), y, x), mi: miTo(y, x), la: y, lo: x, hours: g.opening_hours || "", phone: g.phone || g["contact:phone"] || "", website: g.website || g["contact:website"] || "", cuisine: g.cuisine || "" });
    }
    return pack(list, "openstreetmap");
  };


  // Hours fallbacks, tried in order when OpenStreetMap has none: Google Places (GOOGLE_PLACES_KEY), the place's own website (schema.org data), then a direct OpenStreetMap tag check.
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const fromLd = html => {
    const out = [];
    const walk = o => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(walk);
      if (o.openingHoursSpecification) {
        for (const s of [].concat(o.openingHoursSpecification)) {
          const ds = [].concat(s.dayOfWeek || []).map(d => String(d).replace(/^.*\//, "")).filter(Boolean);
          if (ds.length && s.opens && s.closes) out.push(ds.join(", ") + ": " + String(s.opens).slice(0, 5) + "-" + String(s.closes).slice(0, 5));
        }
      }
      if (!out.length && o.openingHours) for (const h of [].concat(o.openingHours)) if (typeof h === "string") out.push(h);
      for (const k of Object.keys(o)) if (typeof o[k] === "object") walk(o[k]);
    };
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1])); } catch (e) { /* skip bad block */ } }
    return out.join("; ");
  };
  const hoursGoogle = async p => {
    const gk = process.env.GOOGLE_PLACES_KEY;
    if (!gk) return null;
    const r = await timed("https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": gk, "X-Goog-FieldMask": "places.displayName,places.location,places.regularOpeningHours.weekdayDescriptions,places.nationalPhoneNumber,places.websiteUri" }, body: JSON.stringify({ textQuery: p.name + " " + (p.addr || ""), locationBias: { circle: { center: { latitude: p.la, longitude: p.lo }, radius: 400 } }, maxResultCount: 3 }) }, 6000);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) return null;
    const words = sq(name).split(/\s+/).filter(Boolean);
    for (const g of j.places || []) {
      const l = g.location || {}, d = Math.sqrt(((l.longitude - p.lo) * t * Math.cos(p.la * t)) ** 2 + ((l.latitude - p.la) * t) ** 2) * 3958.8;
      if (!(d < 0.25) || !words.every(w => sq(g.displayName && g.displayName.text).includes(w))) continue;
      const wd = g.regularOpeningHours && g.regularOpeningHours.weekdayDescriptions;
      return { hours: wd ? wd.join("; ") : "", phone: g.nationalPhoneNumber || "", website: g.websiteUri || "" };
    }
    return null;
  };
  const hoursSite = async p => {
    if (!/^https?:\/\//i.test(p.website || "")) return null;
    const r = await timed(p.website, { headers: { "User-Agent": "Mozilla/5.0 (compatible; eat-out-app/1.0)", Accept: "text/html" }, redirect: "follow" }, 5000);
    if (!r.ok) return null;
    const h = fromLd((await r.text()).slice(0, 600000));
    return h ? { hours: h } : null;
  };
  const hoursOsm = async p => {
    const q = `[out:json][timeout:8];nwr["opening_hours"](around:80,${p.la},${p.lo});out tags center 20;`;
    const j = await Promise.any(HOSTS.map(async u => { const r = await timed(u, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "eat-out-app/1.0 (personal nutrition finder)" }, body: "data=" + encodeURIComponent(q) }, 9000); if (!r.ok) throw new Error(r.status); return r.json(); }));
    const words = sq(name).split(/\s+/).filter(Boolean), e = (j.elements || []).find(x => x.tags && x.tags.name && words.every(w => sq(x.tags.name).includes(w)));
    return e ? { hours: e.tags.opening_hours, phone: e.tags.phone || e.tags["contact:phone"] || "", website: e.tags.website || e.tags["contact:website"] || "" } : null;
  };
  const fillHours = async p => {
    if (!p || p.hours) return;
    for (const f of [hoursGoogle, hoursSite, hoursOsm]) {
      try { const h = await f(p); if (h && h.hours) { p.hours = h.hours; p.phone = p.phone || h.phone || ""; p.website = p.website || h.website || ""; p.hoursFrom = f === hoursGoogle ? "google" : f === hoursSite ? "website" : "osm"; return; } } catch (e) { /* try the next source */ }
    }
  };

  const errs = [];
  let out = null;
  try { out = await viaGeoapify(); } catch (e) { errs.push(String(e.message || e)); }
  if (!out) { try { out = await viaOverpass(); } catch (e) { errs.push(...(e.errors ? e.errors.map(x => x.message) : [e.message])); } }
  if (!out) { res.setHeader("Cache-Control", "no-store"); return res.status(502).json({ error: "Place lookup unreachable", detail: errs.join("; ").slice(0, 200) }); }
  if (out.found) await fillHours(out.place);
  res.status(200).json(out);
};
