// Simple health endpoint for observability. Returns whether Spotify env vars are present (without revealing secrets).
module.exports = async (req, res) => {
  const hasClient = Boolean(process.env.SPOTIFY_CLIENT_ID);
  const hasSecret = Boolean(process.env.SPOTIFY_CLIENT_SECRET);
  return res.status(200).json({ ok: true, hasClient, hasSecret });
};
