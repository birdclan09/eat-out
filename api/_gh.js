// Tiny GitHub contents-API helper. Saved menus live in data/menus.json in the repo.
const REPO = process.env.GITHUB_REPO || "birdclan09/eat-out", BRANCH = process.env.GITHUB_BRANCH || "main", PATH = "data/menus.json";
const H = () => ({ Authorization: "Bearer " + process.env.GITHUB_TOKEN, Accept: "application/vnd.github+json", "User-Agent": "eat-out-app", "X-GitHub-Api-Version": "2022-11-28" });
const url = `https://api.github.com/repos/${REPO}/contents/${PATH}`;
async function readMenus() {
  const r = await fetch(`${url}?ref=${BRANCH}`, { headers: H() });
  if (r.status === 404) return { menus: {}, sha: null };
  const j = await r.json().catch(() => null);
  if (!r.ok || !j) throw new Error("GitHub read failed (" + r.status + ")" + (j && j.message ? ": " + j.message : ""));
  let menus = {};
  try { menus = JSON.parse(Buffer.from(j.content || "", "base64").toString("utf8") || "{}"); } catch (e) {}
  return { menus, sha: j.sha };
}
async function writeMenus(menus, sha, message) {
  const body = { message, branch: BRANCH, content: Buffer.from(JSON.stringify(menus, null, 1)).toString("base64") };
  if (sha) body.sha = sha;
  const r = await fetch(url, { method: "PUT", headers: { ...H(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error("GitHub write failed (" + r.status + ")" + (j && j.message ? ": " + j.message : "")); e.status = r.status; throw e; }
}
module.exports = { readMenus, writeMenus };
