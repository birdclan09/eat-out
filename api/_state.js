// Per-user app state (favorites, current meal, macro targets, filters) lives in data/state.json on a separate "data" branch,
// so saving it never redeploys the site (vercel.json turns deployments off for that branch).
const REPO = process.env.GITHUB_REPO || "birdclan09/eat-out", MAIN = process.env.GITHUB_BRANCH || "main", BR = process.env.STATE_BRANCH || "data", PATH = "data/state.json";
const H = () => ({ Authorization: "Bearer " + process.env.GITHUB_TOKEN, Accept: "application/vnd.github+json", "User-Agent": "eat-out-app", "X-GitHub-Api-Version": "2022-11-28" });
const base = `https://api.github.com/repos/${REPO}`;
const fail = async (r, what) => { const j = await r.json().catch(() => null); const e = new Error(`${what} failed (${r.status})${j && j.message ? ": " + j.message : ""}`); e.status = r.status; throw e; };
async function ensureBranch() {
  const r = await fetch(`${base}/git/ref/heads/${BR}`, { headers: H() });
  if (r.ok) return;
  if (r.status !== 404) await fail(r, "GitHub branch check");
  const m = await fetch(`${base}/git/ref/heads/${MAIN}`, { headers: H() });
  if (!m.ok) await fail(m, "GitHub main lookup");
  const sha = (await m.json()).object.sha;
  const c = await fetch(`${base}/git/refs`, { method: "POST", headers: { ...H(), "Content-Type": "application/json" }, body: JSON.stringify({ ref: "refs/heads/" + BR, sha }) });
  if (!c.ok && c.status !== 422) await fail(c, "GitHub branch create"); // 422 = it already exists (created a moment ago)
}
async function readState() {
  const r = await fetch(`${base}/contents/${PATH}?ref=${BR}`, { headers: H() });
  if (r.status === 404) return { data: { users: {} }, sha: null };
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) await fail(r, "GitHub read");
  let data = { users: {} };
  try { data = JSON.parse(Buffer.from(j.content || "", "base64").toString("utf8") || "{}"); } catch (e) {}
  if (!data.users) data.users = {};
  return { data, sha: j.sha };
}
async function writeState(data, sha, message) {
  await ensureBranch();
  const body = { message, branch: BR, content: Buffer.from(JSON.stringify(data)).toString("base64") };
  if (sha) body.sha = sha;
  const r = await fetch(`${base}/contents/${PATH}`, { method: "PUT", headers: { ...H(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) await fail(r, "GitHub write");
}
module.exports = { readState, writeState };
