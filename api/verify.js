// Second, independent pass: re-reads the same source and compares every extracted item with what the source prints.
// Returns only the items that do NOT match, so the app can hold them back before the user is offered the import.
const { loadUrl, blocks } = require("./_src");
// VERIFY_MODEL lets the check run on a different (e.g. cheaper) model than the import; falls back to ANTHROPIC_MODEL.
const MODEL = process.env.VERIFY_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const PROMPT = `You are fact-checking an extraction against the attached source. The list below has one item per line as: index|name|calories|protein_g|carbs_g|fat_g (an empty field means it was not extracted).
For every line, find that item in the source and compare each number with what the source actually prints. Be strict: a number must match the source exactly. Treat "<1" in the source as matching an empty field. Watch for shifted table columns, the wrong size or variant row, and misread digits.
Return ONLY compact JSON on one line, listing only lines that do NOT match: {"problems":[[index,"field","extracted","source says"]]}
"field" is one of name, calories, protein, carbs, fat, notfound (use notfound if the item is not in the source at all). Return {"problems":[]} if everything matches. Do not list items that match. No prose.`;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
  if (process.env.EDIT_KEY && req.headers["x-edit-key"] !== process.env.EDIT_KEY) return res.status(401).json({ error: "Wrong or missing edit key." });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const items = Array.isArray(b.items) ? b.items.slice(0, 400) : [];
    if (!items.length) return res.status(400).json({ error: "No items to check." });
    let src;
    if (b.mode === "file") {
      if (!b.data || !/^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(b.mime)) return res.status(400).json({ error: "Bad file." });
      src = blocks(b.mime === "application/pdf" ? "pdf" : "image", { data: b.data, mime: b.mime });
    } else {
      const d = await loadUrl(String(b.url || "")); src = blocks(d.kind, d);
    }
    const list = items.map((i, x) => [x, String(i[0] || "").replace(/\|/g, "/"), i[1] ?? "", i[2] ?? "", i[3] ?? "", i[4] ?? ""].join("|")).join("\n");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 6000, messages: [{ role: "user", content: [src, { type: "text", text: PROMPT + "\n\nEXTRACTED ITEMS:\n" + list }] }] }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error("Claude API: " + ((j && j.error && j.error.message) || r.status));
    const text = (j.content || []).filter(x => x.type === "text").map(x => x.text).join("\n");
    const p = parseProblems(text, j.stop_reason === "max_tokens");
    if (!p) throw new Error("The check's reply couldn't be read.");
    const problems = p.filter(q => Array.isArray(q) && Number.isInteger(q[0]) && q[0] >= 0 && q[0] < items.length)
      .map(q => ({ i: q[0], field: String(q[1] || ""), got: String(q[2] ?? ""), src: String(q[3] ?? "") }));
    return res.status(200).json({ checked: items.length, problems });
  } catch (e) { return res.status(502).json({ error: String(e.message || e).slice(0, 220) }); }
};

// Reads {"problems":[[...],...]}; if the reply was cut off, keeps every complete problem.
function parseProblems(text, truncated) {
  const a = text.indexOf("{"), z = text.lastIndexOf("}");
  if (a >= 0 && z > a && !truncated) { try { const o = JSON.parse(text.slice(a, z + 1)); if (Array.isArray(o.problems)) return o.problems; } catch (e) { /* salvage below */ } }
  const k = text.indexOf("[", text.indexOf("problems")); if (k < 0) return null;
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let p = k + 1; p < text.length; p++) {
    const ch = text[p];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "[") { if (depth === 0) start = p; depth++; }
    else if (ch === "]") { if (depth === 0) break; depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(text.slice(start, p + 1))); } catch (e) { /* skip */ } start = -1; } }
  }
  return truncated || out.length ? out : [];
}
module.exports.parseProblems = parseProblems;
