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
    // forward status and body
    return res.status(tokenResp.ok ? 200 : 500).json(json);
  } catch (err) {
    console.error('exchange error', err);
    return res.status(500).json({ error: 'exchange_failed', message: String(err) });
  }
};
