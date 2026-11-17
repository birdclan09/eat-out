// Finds a restaurant's OWN published nutrition guide. Web search often surfaces old copies (2017-2024, campus mirrors) and misses the
// current PDF, so we find the official site, read the links on its pages, and rank the nutrition/allergen PDFs newest first.
const AGG = /(yelp|facebook|instagram|tripadvisor|mynetdiary|bigoven|doordash|ubereats|grubhub|toasttab|toast\.app|opentable|tock|mapquest|aaa\.com|reddit|pinterest|tiktok|youtube|findmeglutenfree|restaurantguru|restaurantji|singleplatform|menuxp|nutritionix|fatsecret|calorieking|myfitnesspal|wikipedia|google|substack|medium\.com|bowlmacros|myfooddiary|syndigo|attribytes)/i;
const STOP = /^(restaurant|kitchen|grill|house|cafe|steakhouse|japanese|southern|bistro|eatery|the)$/;
const toks = name => String(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !STOP.test(t));

// True when the URL's host looks like the restaurant's own site (its name is in the host) and isn't an aggregator.
function isOwn(name, u) {
  const t = toks(name); if (!t.length) return false;
  try { const h = new URL(u).hostname.replace(/^www\./, "").toLowerCase(); return !AGG.test(h) && t.some(x => h.replace(/[^a-z0-9]/g, "").includes(x)); } catch (e) { return false; }
}
const isPdf = u => { try { return /\.pdf$/i.test(new URL(u).pathname); } catch (e) { return false; } };
// WordPress-style /uploads/2025/08/ gives a year and month; anything else counts as old.
const when = u => { const m = /\/(20\d\d)\/(0[1-9]|1[0-2])\//.exec(u) || /(20\d\d)[-_.]?(0[1-9]|1[0-2])/.exec(u); return m ? +m[1] * 12 + +m[2] : 0; };
const guide = u => /nutrition|allergen|calorie/i.test(decodeURIComponent(u));
const junk = u => /takeout|catering|license|kids-menu|gift|esg|report|press/i.test(u);

// Best first: nutrition/allergen PDFs on the restaurant's own site, newest date first. Other own-site PDFs and pages follow.
function rank(urls) {
  const seen = new Set(), list = [];
  for (const u of urls) { if (seen.has(u)) continue; seen.add(u); list.push(u); }
  const tier = u => (isPdf(u) && guide(u) ? 0 : guide(u) ? 1 : isPdf(u) && !junk(u) ? 2 : 3);
  return list.sort((a, b) => tier(a) - tier(b) || when(b) - when(a));
}

// urls: everything the web search saw or named. Returns ordered candidate URLs to read in full (own site only).
async function candidates(name, urls, loadUrl) {
  const own = urls.filter(u => isOwn(name, u));
  const out = [...own.filter(isPdf)];
  const origins = [...new Set(own.map(u => { try { return new URL(u).origin; } catch (e) { return ""; } }).filter(Boolean))].slice(0, 2);
  for (const o of origins) {
    for (const p of [o + "/", ...own.filter(u => !isPdf(u) && u.startsWith(o)).slice(0, 2)]) {
      try { const d = await loadUrl(p); (d.links || []).forEach(l => { if (isOwn(name, l) || new URL(l).origin === o) out.push(l); }); } catch (e) { /* page unreadable; try the next */ }
    }
  }
  const good = rank(out).filter(u => isPdf(u) ? !junk(u) || guide(u) : guide(u));
  return good.slice(0, 4);
}
module.exports = { isOwn, isPdf, rank, candidates, when };
