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
let currentData = { me: null, topTracks: [], topArtists: [], playlists: [] };

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-btn').addEventListener('click', onLoginClicked);
  document.getElementById('logout-btn').addEventListener('click', onLogout);
  document.getElementById('brand-btn').addEventListener('click', () => switchView('home'));
  
  // Setup nav item listeners
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const view = e.target.getAttribute('data-view');
      switchView(view);
    });
  });
  
  // Setup mobile nav listeners
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const view = e.currentTarget.getAttribute('data-view');
      switchView(view);
    });
  });
  
  const params = new URLSearchParams(window.location.search);
  if (params.get('code')) {
    handleRedirect();
  } else {
    // try to use access token from storage
    const token = getStoredToken();
    if (token) {
      fetchAndRender(token);
    } else {
      // try server-side refresh using cookie
      attemptRefresh();
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
  n.style.display = msg ? '' : 'none';
}

function hideNotice(){
  const n = document.querySelector('.notice');
  if (n) n.style.display = 'none';
}

async function attemptRefresh(){
  showNotice('Checking session...');
  try{
    const resp = await fetch('/api/refresh', { method: 'POST' });
    if (!resp.ok) {
      // no active session or refresh failed
      hideNotice();
      return null;
    }
    const tokenObj = await resp.json();
    if (tokenObj && tokenObj.access_token) {
      storeToken(tokenObj);
      fetchAndRender(tokenObj);
      // show logout button
      showLoggedIn(true);
      return tokenObj;
    }
  }catch(err){
    console.error('refresh attempt failed', err);
    hideNotice();
  }
  return null;
}

function showLoggedIn(is){
  const loginBtn = document.getElementById('login-btn');
  const logoutBtn = document.getElementById('logout-btn');
  if (is) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = '';
  } else {
    if (loginBtn) loginBtn.style.display = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

async function onLogout(){
  try{
    await fetch('/api/logout', { method: 'POST' });
  }catch(e){console.warn('logout call failed', e)}
  localStorage.removeItem('spotify_token');
  showLoggedIn(false);
  currentData = { me: null, topTracks: [], topArtists: [], playlists: [] };
  // clear UI
  document.getElementById('profile-area').innerHTML = '';
  document.getElementById('cards').innerHTML = '';
  document.getElementById('home-top-tracks').innerHTML = '';
  document.getElementById('top-tracks').innerHTML = '';
  document.getElementById('top-artists').innerHTML = '';
  document.getElementById('playlists').innerHTML = '';
  switchView('home');
  showNotice('Signed out');
}

/* ---------- Fetch & render ---------- */
async function fetchAndRender(tokenObj){
  demoMode = false;
  showNotice('Loading your Spotify stats...');
  try{
    const access_token = tokenObj.access_token;
    const me = await apiGet('/v1/me', access_token);
    const topTracks = await apiGet('/v1/me/top/tracks?limit=50&time_range=medium_term', access_token);
    const topArtists = await apiGet('/v1/me/top/artists?limit=50&time_range=medium_term', access_token);
    const playlists = await apiGet('/v1/me/playlists?limit=50', access_token);
    
    currentData = {
      me,
      topTracks: topTracks.items,
      topArtists: topArtists.items,
      playlists: playlists.items
    };
    
    renderProfile(me);
    renderHomeView();
    renderTopTracksView();
    renderTopArtistsView();
    renderPlaylistsView();
    
    hideNotice();
    showLoggedIn(true);
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
  
  currentData = {
    me: demo.profile,
    topTracks: demo.top_tracks || [],
    topArtists: demo.top_artists || [],
    playlists: demo.playlists || []
  };
  
  renderProfile(demo.profile);
  renderHomeView();
  renderTopTracksView();
  renderTopArtistsView();
  renderPlaylistsView();
  hideNotice();
}

/* ---------- Render helpers ---------- */
function switchView(view){
  // Hide all views
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(n => n.classList.remove('active'));
  
  // Show selected view
  const viewMap = {
    'home': 'view-home',
    'top-tracks': 'view-top-tracks',
    'top-artists': 'view-top-artists',
    'playlists': 'view-playlists'
  };
  
  const viewId = viewMap[view] || 'view-home';
  const viewEl = document.getElementById(viewId);
  if (viewEl) viewEl.classList.add('active');
  
  // Update nav active state
  if (view !== 'home') {
    const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (navItem) navItem.classList.add('active');
    
    const mobileNavItem = document.querySelector(`.mobile-nav-item[data-view="${view}"]`);
    if (mobileNavItem) mobileNavItem.classList.add('active');
  } else {
    const mobileNavItem = document.querySelector(`.mobile-nav-item[data-view="home"]`);
    if (mobileNavItem) mobileNavItem.classList.add('active');
  }
}

function renderHomeView(){
  renderCards({topTracks: currentData.topTracks.slice(0,6), topArtists: currentData.topArtists.slice(0,6)});
  renderTracks(currentData.topTracks.slice(0,10), 'home-top-tracks');
}

function renderTopTracksView(){
  renderTracks(currentData.topTracks, 'top-tracks');
}

function renderTopArtistsView(){
  const container = document.getElementById('top-artists');
  container.innerHTML = '';
  for (const artist of currentData.topArtists){
    const card = el('div',{class:'artist-card'});
    const img = artist.images && artist.images[0] ? artist.images[0].url : 'https://via.placeholder.com/300?text=Artist';
    card.appendChild(el('img',{src:img,alt:artist.name}));
    card.appendChild(el('div',{class:'name'},[document.createTextNode(artist.name)]));
    const followers = artist.followers ? `${(artist.followers.total / 1000).toFixed(1)}K followers` : '';
    card.appendChild(el('div',{class:'followers'},[document.createTextNode(followers)]));
    container.appendChild(card);
  }
}

function renderPlaylistsView(){
  const container = document.getElementById('playlists');
  container.innerHTML = '';
  for (const playlist of currentData.playlists){
    const card = el('div',{class:'playlist-card'});
    const img = playlist.images && playlist.images[0] ? playlist.images[0].url : 'https://via.placeholder.com/300?text=Playlist';
    card.appendChild(el('img',{src:img,alt:playlist.name}));
    card.appendChild(el('div',{class:'name'},[document.createTextNode(playlist.name)]));
    const trackCount = `${playlist.tracks.total} tracks`;
    card.appendChild(el('div',{class:'track-count'},[document.createTextNode(trackCount)]));
    container.appendChild(card);
  }
}

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

function renderTracks(tracks, containerId){
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (const t of tracks){
    const row = el('div',{class:'track'});
    const img = t.album && t.album.images && t.album.images[0] ? t.album.images[0].url : (t.image || '');
    row.appendChild(el('img',{src:img,alt:t.name}));
    const meta = el('div',{class:'meta'});
    meta.appendChild(el('div',{class:'name'},[document.createTextNode(t.name)]));
    const artists = (t.artists || []).map(a=>a.name).join(', ') || t.artist || '';
    meta.appendChild(el('div',{class:'artist'},[document.createTextNode(artists)]));
    row.appendChild(meta);
    container.appendChild(row);
  }
}

// expose small helper for debugging
window.statspotify = {loadDemo, onLoginClicked, onLogout, attemptRefresh, switchView};
