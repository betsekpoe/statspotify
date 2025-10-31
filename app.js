// Basic StatSpotify frontend (ES module)
// CONFIG: paste your Spotify client id here if you want to try a real login flow.
// NOTE: token exchange may be blocked by CORS on Spotify's token endpoint; see README for a serverless exchange example.
// CONFIG: the public Spotify client id (safe to expose). PKCE flow uses this.
// NOTE: token exchange happens server-side in /api/exchange (keeps client secret safe).
const CLIENT_ID = 'f08fbf07534e4f399933d3b12e54f6fd';
const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = 'user-top-read user-read-private user-read-email';
const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

let demoMode = false;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-btn').addEventListener('click', onLoginClicked);
  document.getElementById('demo-btn').addEventListener('click', () => loadDemo());
  const params = new URLSearchParams(window.location.search);
  if (params.get('code')) {
    handleRedirect();
  } else {
    // try to use access token from storage
    const token = getStoredToken();
    if (token) {
      fetchAndRender(token);
    }
  }
});

function el(tag, attrs = {}, children = []){
  const e = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of children) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

/* ---------- PKCE helpers ---------- */
function randomString(length = 64){
  const arr = new Uint8Array(length/2);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => ('0' + b.toString(16)).slice(-2)).join('');
}

async function sha256(plain){
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash);
}

function base64UrlEncode(arr){
  let s = btoa(String.fromCharCode(...arr));
  s = s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return s;
}

async function generateCodeChallenge(verifier){
  const hashed = await sha256(verifier);
  return base64UrlEncode(hashed);
}

/* ---------- Auth flow ---------- */
async function onLoginClicked(){
  if (!CLIENT_ID) {
    alert('No CLIENT_ID set in app.js. Use demo mode or add your Spotify client id following README.');
    return;
  }
  const verifier = randomString(128);
  const challenge = await generateCodeChallenge(verifier);
  localStorage.setItem('pkce_verifier', verifier);
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  // prompt for dialog to allow account choose
  url.searchParams.set('show_dialog', 'true');
  window.location.href = url.toString();
}

async function handleRedirect(){
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return;
  // remove code from URL to keep things clean
  history.replaceState({}, document.title, REDIRECT_URI);
  const verifier = localStorage.getItem('pkce_verifier');
  if (!verifier) {
    showNotice('Missing PKCE verifier. Try logging in again.');
    return;
  }
  showNotice('Exchanging code for token via server...');
  try {
    // Prefer server-side exchange to avoid CORS and to keep client secret safe.
    const resp = await fetch('/api/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: REDIRECT_URI })
    });
    if (!resp.ok) {
      const t = await resp.text();
      showNotice('Token exchange failed on server. See console for details.');
      console.error('server exchange error', resp.status, t);
      return;
    }
    const tokenObj = await resp.json();
    if (tokenObj.error) {
      showNotice('Token exchange returned an error: ' + (tokenObj.error_description || tokenObj.error));
      console.error('token error', tokenObj);
      return;
    }
    storeToken(tokenObj);
    fetchAndRender(tokenObj);
  } catch (err) {
    console.error(err);
    showNotice('Token exchange failed (network/server). See README for serverless exchange guidance.');
  }
}

function storeToken(obj){
  const stored = { ...obj, obtained_at: Date.now() };
  localStorage.setItem('spotify_token', JSON.stringify(stored));
}

function getStoredToken(){
  const s = localStorage.getItem('spotify_token');
  if (!s) return null;
  try{
    const obj = JSON.parse(s);
    // basic expiry check
    if (obj.expires_in && obj.obtained_at && (Date.now() - obj.obtained_at) / 1000 > obj.expires_in) {
      localStorage.removeItem('spotify_token');
      return null;
    }
    return obj;
  }catch(e){return null}
}

function showNotice(msg){
  let n = document.querySelector('.notice');
  if (!n){
    n = el('div',{class:'notice'});
    document.querySelector('.main').prepend(n);
  }
  n.textContent = msg;
}

/* ---------- Fetch & render ---------- */
async function fetchAndRender(tokenObj){
  demoMode = false;
  showNotice('Loading your Spotify stats...');
  try{
    const access_token = tokenObj.access_token;
    const me = await apiGet('/v1/me', access_token);
    const topTracks = await apiGet('/v1/me/top/tracks?limit=10', access_token);
    const topArtists = await apiGet('/v1/me/top/artists?limit=6', access_token);
    renderProfile(me);
    renderCards({topTracks: topTracks.items, topArtists: topArtists.items});
    renderTopTracks(topTracks.items);
    showNotice('');
  }catch(err){
    console.error(err);
    showNotice('Failed to fetch Spotify API data. Token may be invalid or network restricted.');
  }
}

async function apiGet(path, access_token){
  const resp = await fetch('https://api.spotify.com' + path, {headers:{Authorization:'Bearer '+access_token}});
  if (!resp.ok) throw new Error('API error '+resp.status);
  return await resp.json();
}

/* ---------- Demo / sample data ---------- */
async function loadDemo(){
  demoMode = true;
  showNotice('Loading demo data...');
  const resp = await fetch('sample_data.json');
  const demo = await resp.json();
  renderProfile(demo.profile);
  renderCards({topTracks: demo.top_tracks.slice(0,6), topArtists: demo.top_artists.slice(0,6)});
  renderTopTracks(demo.top_tracks.slice(0,20));
  showNotice('Demo data loaded — no Spotify account needed.');
}

/* ---------- Render helpers ---------- */
function renderProfile(me){
  const area = document.getElementById('profile-area');
  area.innerHTML = '';
  if (!me) return;
  const img = me.images && me.images[0] ? el('img',{src:me.images[0].url,style:'width:40px;height:40px;border-radius:50%'}): el('div',{style:'width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.06)'});
  const name = el('div',{},[el('div',{class:'small'},me.display_name || me.name || 'You')]);
  area.appendChild(img);
  area.appendChild(name);
}

function renderCards({topTracks = [], topArtists = []}){
  const cards = document.getElementById('cards');
  cards.innerHTML = '';
  const topTrack = topTracks[0];
  const favoriteArtist = topArtists[0];
  cards.appendChild(card('Top Track', topTrack ? topTrack.name : '—', topTrack ? topTrack.album && topTrack.album.images && topTrack.album.images[0] ? topTrack.album.images[0].url : '' : ''));
  cards.appendChild(card('Top Artist', favoriteArtist ? favoriteArtist.name : '—', favoriteArtist ? favoriteArtist.images && favoriteArtist.images[0] ? favoriteArtist.images[0].url : '' : ''));
  cards.appendChild(card('Total Tracks in List', String((topTracks && topTracks.length) || 0)));
}

function card(title, value, img){
  const c = el('div',{class:'card'});
  c.appendChild(el('div',{class:'title'},[document.createTextNode(title)]));
  if (img){
    const row = el('div',{style:'display:flex;align-items:center;gap:12px'});
    row.appendChild(el('img',{src:img,style:'width:56px;height:56px;border-radius:8px;object-fit:cover'}));
    row.appendChild(el('div',{},[el('div',{class:'value'},[document.createTextNode(value)])]));
    c.appendChild(row);
  } else {
    c.appendChild(el('div',{class:'value'},[document.createTextNode(value)]));
  }
  return c;
}

function renderTopTracks(tracks){
  const container = document.getElementById('top-tracks');
  container.innerHTML = '';
  for (const t of tracks){
    const row = el('div',{class:'track'});
    const img = t.album && t.album.images && t.album.images[0] ? t.album.images[0].url : (t.image || '');
    row.appendChild(el('img',{src:img,alt:t.name}));
    const meta = el('div',{class:'meta'});
    meta.appendChild(el('div',{class:'name'},[document.createTextNode(t.name)]));
    const artists = (t.artists || t.artists || []).map(a=>a.name).join(', ') || t.artist || '';
    meta.appendChild(el('div',{class:'artist'},[document.createTextNode(artists)]));
    row.appendChild(meta);
    container.appendChild(row);
  }
}

// expose small helper for debugging
window.statspotify = {loadDemo, onLoginClicked};
