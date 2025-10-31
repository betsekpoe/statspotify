# StatSpotify (statspotify)

This is a small static frontend that shows your Spotify listening stats in a Spotify-like UI. It is built using only HTML, CSS and JavaScript so it can be deployed to services like Vercel.

Features
- Spotify-like dark UI with sidebar, header, cards, and top-tracks list
- Demo mode (no Spotify credentials required)
- Client-side PKCE auth flow scaffolded (see notes about token exchange and CORS)

Quick start (demo)
1. Open `index.html` in a browser (or deploy to Vercel) and click "Use demo data".

Try with your Spotify account (notes)
- Edit `app.js` and set `CLIENT_ID` to your Spotify application client id.
- Configure a Redirect URI in your Spotify Dashboard to the URL where the app will run. For local testing, use `http://localhost:3000/` or the exact path where `index.html` is served.

Important: token exchange and CORS
---------------------------------
Spotify's Authorization Code flow with PKCE requires exchanging the authorization code for tokens at `https://accounts.spotify.com/api/token`. Many browsers block cross-origin requests to that endpoint from static pages due to CORS. If you run into CORS issues during token exchange, there are two options:

1) Use a tiny serverless function (recommended for Vercel deploys)

Create an API endpoint that accepts the `code` and `code_verifier` from the client and performs the POST request to Spotify's token endpoint server-side, then returns the token JSON to the client. Because this request originates from your server, CORS is not an issue.

Example (Node.js serverless function for Vercel - sketch):

```js
// api/exchange.js (Vercel serverless)
const fetch = require('node-fetch');
module.exports = async (req, res) => {
  const { code, code_verifier, redirect_uri } = req.body;
  const client_id = process.env.SPOTIFY_CLIENT_ID;
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri,
    client_id,
    code_verifier
  });
  const resp = await fetch('https://accounts.spotify.com/api/token', { method:'POST', body });
  const json = await resp.json();
  res.status(resp.ok?200:500).json(json);
}
```

Then change the exchange in `app.js` to POST to your `/api/exchange` endpoint instead of calling Spotify's token endpoint directly.

2) Use demo mode

If you don't want to maintain a server, use the demo mode by clicking "Use demo data". The UI will populate with sample data so you can iterate on the design.

Deploying to Vercel
- Create a new Vercel project (select this repo/folder). If you add the serverless exchange function above, set `SPOTIFY_CLIENT_ID` in Vercel's Environment Variables. Configure your Spotify app redirect URI to the deployed URL + path.

Files
- `index.html` — app shell and UI
- `styles.css` — styling
- `app.js` — front-end logic (PKCE helpers, demo loader, renderer)
- `sample_data.json` — demo content

Next steps and suggestions
- Add charts for listening trends (Chart.js or similar) — requires adding a dependency
- Add a small serverless exchange endpoint (recommended) and refresh tokens handling
- Add playlist visualizations and track preview playbacks

If you'd like, I can also:
- add small unit tests for the JS rendering functions
- wire up a minimal deploy config for Vercel

Serverless exchange (what I added)
---------------------------------
I added a serverless token-exchange endpoint at `api/exchange.js` intended for Vercel deployments. It takes a JSON POST with `{ code, code_verifier, redirect_uri }`, performs the authorized POST to Spotify's token endpoint using your `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` from environment variables, and forwards the token JSON to the client.

Environment variables you should set (Vercel or your server environment):

- `SPOTIFY_CLIENT_ID` — your Spotify app client id
- `SPOTIFY_CLIENT_SECRET` — your Spotify app client secret
- `NEXT_PUBLIC_BASE_URL` — (optional) public URL where the app will run (helpful in some setups)

Local testing notes
-------------------
To test locally you have two main options:

1) Use `vercel dev` (recommended if you use Vercel):

  - Install the Vercel CLI and run `vercel dev` from the project root. Set the environment variables in your Vercel project or using a `.env` file.

2) Run a tiny local server that can serve static files and forward `/api/exchange` to the same `api/exchange.js` logic (for example, using Node/Express) or run `vercel dev` which emulates the serverless functions locally.

PowerShell example to run a simple static server (demo mode):

```powershell
# serve static files on port 3000
python -m http.server 3000
# open http://127.0.0.1:3000 and click "Use demo data"
```

Security note
-------------
Do NOT commit your `SPOTIFY_CLIENT_SECRET` into source control. Use Vercel's Environment Variables or a secure secrets mechanism. The serverless function keeps the secret out of the browser.

If you want, I can now:

- wire up `app.js` to call a configurable server endpoint (if you host the exchange elsewhere)
- add example Vercel project settings and a `.env.example` (without secrets)

