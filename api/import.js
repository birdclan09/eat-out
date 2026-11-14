// Turns a menu/nutrition page, PDF or screenshot (or a web search) into a list of items for the user to review.
// Uses the Anthropic API (ANTHROPIC_API_KEY). Nothing is saved here; the app saves via /api/menus after review.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const PROMPT = `Extract nutrition facts for menu items from the source. Return ONLY compact JSON on a single line (no indentation, no prose) in exactly this shape:
{"items":[["name","category","serving",calories,protein,carbs,fat]],"notes":["",""]}
Each item is one array in that order. Use null for carbs or fat if not stated, and "" for category or serving if not stated.
Rules: only include items where the source states calories and protein (grams). Never estimate or invent numbers. Use the numbers exactly as printed; if a size is listed, make the size part of the item name. Carbs and fat may be null if not stated. "notes" is a list of at most 5 short plain-English bullets (under 15 words each) the user should double-check: first the date or revision shown on the source if any, then any items whose printed numbers look inconsistent (name the item), then anything skipped. Leave it as [] if nothing needs checking.`;
const bad = h => /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(h) || !h.includes(".");
const strip = html => html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(tr|p|div|li|h\d)>/gi, "\n").replace(/<\/(td|th)>/gi, " | ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

async function loadUrl(u) {
  let url; try { url = new URL(u); } catch (e) { throw new Error("That doesn't look like a web link."); }
  if (!/^https?:$/.test(url.protocol) || bad(url.hostname)) throw new Error("That link can't be used.");
  const c = new AbortController(), tm = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(url, { signal: c.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; eat-out-app)", Accept: "text/html,application/pdf,image/*" } });
    if (!r.ok) throw new Error("The site returned " + r.status + ". Try uploading a PDF or screenshot instead.");
    const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 20e6) throw new Error("That file is too large.");
    if (type === "application/pdf" || /\.pdf($|\?)/i.test(url.pathname)) return { kind: "pdf", data: buf.toString("base64") };
    if (/^image\/(png|jpe?g|gif|webp)$/.test(type)) return { kind: "image", mime: type.replace("jpg", "jpeg"), data: buf.toString("base64") };
    const text = strip(buf.toString("utf8")).slice(0, 150000);
    if (text.length < 200) throw new Error("That page has almost no readable text (it may load its menu with JavaScript). Upload the PDF or a screenshot instead.");
    return { kind: "text", text };
  } finally { clearTimeout(tm); }
}

// Reads the model's reply. If the JSON is cut off (a very long table) or has stray text, keep every complete item.
function parseOut(text, truncated) {
  const a = text.indexOf("{"), z = text.lastIndexOf("}");
  if (a < 0) throw new Error("Couldn't find any menu items in that source.");
  if (!truncated && z > a) { try { return JSON.parse(text.slice(a, z + 1)); } catch (e) { /* fall through to salvage */ } }
  const it = text.indexOf('"items"'), k = it < 0 ? -1 : text.indexOf("[", it);
  const fail = () => new Error("The result couldn't be read. Try again or use a smaller source.");
  if (k < 0) throw fail();
  const items = []; let depth = 0, start = -1, inStr = false, esc = false, closed = false;
  for (let p = k + 1; p < text.length; p++) {
    const ch = text[p];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "[" || ch === "{") { if (depth === 0) start = p; depth++; }
    else if (ch === "]" || ch === "}") {
      if (depth === 0) { closed = ch === "]"; break; }
      depth--;
      if (depth === 0 && start >= 0) { try { items.push(JSON.parse(text.slice(start, p + 1))); } catch (e) { /* skip one bad item */ } start = -1; }
    }
  }
  if (!items.length) throw fail();
  const m = text.match(/"notes"\s*:\s*"((?:[^"\\]|\\.)*)"/), sr = text.match(/"source"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return { items, notes: m ? m[1] : "", source: sr ? sr[1] : undefined, partial: truncated || !closed };
}

async function ask(content, tools) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 16000, messages: [{ role: "user", content }], ...(tools ? { tools } : {}) }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error("Claude API: " + ((j && j.error && j.error.message) || r.status));
  const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  try { return parseOut(text, j.stop_reason === "max_tokens"); }
  catch (e) {
    // Show what the model actually sent back, so a failure can be diagnosed instead of guessed at.
    const peek = text.replace(/\s+/g, " ").slice(0, 160) || "(empty reply)";
    throw new Error(e.message + " [stop: " + (j.stop_reason || "?") + "; reply began: " + peek + "]");
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
  if (process.env.EDIT_KEY && req.headers["x-edit-key"] !== process.env.EDIT_KEY) return res.status(401).json({ error: "Wrong or missing edit key." });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const name = String(b.name || "").slice(0, 100);
    let content, tools, source = null;
    if (b.mode === "search") {
      if (!name) return res.status(400).json({ error: "Missing restaurant name." });
      tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
      content = [{ type: "text", text: `Find the official published nutrition information (calories, protein, carbs, fat) for the menu of the restaurant "${name}"${b.near ? " near " + String(b.near).slice(0, 60) : ""}. Use only the restaurant's own website or official nutrition PDF; skip calorie-tracker sites, reviews and forums. Add "source":"<the exact URL you used>" to the JSON.\n\n${PROMPT}` }];
    } else if (b.mode === "file") {
      if (!b.data || !/^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(b.mime)) return res.status(400).json({ error: "Upload a PDF, PNG or JPEG." });
      content = [b.mime === "application/pdf" ? { type: "document", source: { type: "base64", media_type: b.mime, data: b.data } } : { type: "image", source: { type: "base64", media_type: b.mime, data: b.data } }, { type: "text", text: `Restaurant: ${name}\n\n${PROMPT}` }];
      source = { kind: "file" };
    } else {
      const d = await loadUrl(String(b.url || ""));
      source = { url: String(b.url), kind: d.kind === "text" ? "page" : d.kind };
      content = [d.kind === "pdf" ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: d.data } } : d.kind === "image" ? { type: "image", source: { type: "base64", media_type: d.mime, data: d.data } } : { type: "text", text: "SOURCE PAGE TEXT:\n" + d.text }, { type: "text", text: `Restaurant: ${name}\n\n${PROMPT}` }];
    }
    const out = await ask(content, tools);
    const num = v => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 ? x : null; };
    const row = i => Array.isArray(i) ? { name: i[0], category: i[1], serving: i[2], calories: i[3], protein: i[4], carbs: i[5], fat: i[6] } : (i || {});
    const notes = [].concat(out.partial ? ["Only part of this source could be read (it was very long), so some items are missing."] : [], Array.isArray(out.notes) ? out.notes : out.notes ? [out.notes] : []).map(x => String(x).trim()).filter(Boolean).slice(0, 6);
    const items = (out.items || []).map(row).map(i => ({ n: String(i.name || "").trim(), c: String(i.category || "").trim(), b: String(i.serving || "").trim(), cal: num(i.calories), p: num(i.protein), cb: num(i.carbs), f: num(i.fat) })).filter(i => i.n && i.cal > 0 && i.p != null);
    if (b.mode === "search" && out.source) source = { url: String(out.source), kind: "search" };
    if (!items.length) return res.status(200).json({ items: [], notes: notes.length ? notes : ["No items with calories and protein were found."], source });
    return res.status(200).json({ items, notes, source });
  } catch (e) { return res.status(502).json({ error: String(e.message || e).slice(0, 220) }); }
};
