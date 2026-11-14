// Setup check: shows which server settings exist. Reports true/false only, never the values.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const has = n => !!process.env[n];
  res.status(200).json({
    menu_saving: { GITHUB_TOKEN: has("GITHUB_TOKEN") },
    menu_import: { ANTHROPIC_API_KEY: has("ANTHROPIC_API_KEY") },
    edit_lock: { EDIT_KEY: has("EDIT_KEY") },
    nearby_and_town_search: { GEOAPIFY_KEY: has("GEOAPIFY_KEY") },
    online_lookup: { FATSECRET_CLIENT_ID: has("FATSECRET_CLIENT_ID"), FATSECRET_CLIENT_SECRET: has("FATSECRET_CLIENT_SECRET") },
  });
};
