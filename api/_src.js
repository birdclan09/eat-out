// Shared by import.js and verify.js: fetch a link (page, PDF or image) safely.
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

function blocks(kind, d) {
  return kind === "pdf" ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: d.data } }
    : kind === "image" ? { type: "image", source: { type: "base64", media_type: d.mime, data: d.data } } : { type: "text", text: "SOURCE TEXT:\n" + d.text };
}
module.exports = { loadUrl, blocks };
