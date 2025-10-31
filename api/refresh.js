// Serverless endpoint to refresh the Spotify access token using the refresh token stored in an httpOnly cookie.
module.exports = async (req, res) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const cookies = req.headers.cookie || '';
    const match = cookies.split(';').map(s=>s.trim()).find(s=>s.startsWith('spotify_refresh='));
    if (!match) return res.status(401).json({ error: 'missing_refresh' });
    const refreshToken = decodeURIComponent(match.split('=')[1] || '');

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.status(500).json({ error: 'server misconfigured: missing SPOTIFY_CLIENT_ID/SECRET' });

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });

    const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });

    const json = await tokenResp.json();
    if (!tokenResp.ok) return res.status(500).json(json);

    // If Spotify returned a new refresh_token, update cookie
    if (json.refresh_token) {
      const maxAge = 60 * 60 * 24 * 30; // 30 days
      const cookie = `spotify_refresh=${encodeURIComponent(json.refresh_token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}`;
      res.setHeader('Set-Cookie', cookie);
    }

    // return only access token details
    const safe = {
      access_token: json.access_token,
      token_type: json.token_type,
      expires_in: json.expires_in,
      scope: json.scope
    };
    return res.status(200).json(safe);
  } catch (err) {
    console.error('refresh error', err);
    return res.status(500).json({ error: 'refresh_failed', message: String(err) });
  }
};
