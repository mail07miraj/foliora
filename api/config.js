module.exports = function(req, res) {
  res.status(200).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return res.status(500).end(JSON.stringify({
      error: "Supabase configuration is missing on the server."
    }));
  }
  return res.end(JSON.stringify({ url, anonKey }));
};
