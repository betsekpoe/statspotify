// Clears the refresh token cookie so the user is logged out server-side.
module.exports = async (req, res) => {
  // clear cookie
  const cookie = `spotify_refresh=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}`;
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ ok: true });
};
