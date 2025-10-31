// Serverless token exchange for Spotify Authorization Code + PKCE
// Place this file at `api/exchange.js` for Vercel deployments.
// It expects the environment variables SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to be set.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, code_verifier, redirect_uri } = req.body || {};
    if (!code || !code_verifier) return res.status(400).json({ error: 'missing code or code_verifier' });

    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'server misconfigured: missing SPOTIFY_CLIENT_ID/SECRET' });
    }

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect_uri || '',
      code_verifier
    });

    const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    const json = await tokenResp.json();
    // If successful, store the refresh_token in a secure, httpOnly cookie and return only the access token to the client
    if (tokenResp.ok) {
      const refreshToken = json.refresh_token;
      if (refreshToken) {
        // set cookie for 30 days
        const maxAge = 60 * 60 * 24 * 30; // 30 days in seconds
        const cookie = `spotify_refresh=${encodeURIComponent(refreshToken)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax; ${process.env.NODE_ENV === 'production' ? 'Secure; ' : ''}`;
        res.setHeader('Set-Cookie', cookie);
      }

      // return only non-sensitive token info to the client
      const safe = {
        access_token: json.access_token,
        token_type: json.token_type,
        expires_in: json.expires_in,
        scope: json.scope
      };
      return res.status(200).json(safe);
    }

    // forward error body (do not leak secrets)
    return res.status(500).json(json);
  } catch (err) {
    console.error('exchange error', err);
    return res.status(500).json({ error: 'exchange_failed', message: String(err) });
  }
};
