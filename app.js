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
let allData = { topTracks: [], topArtists: [], playlists: [] }; // Store unfiltered data for search
let chartData = { short_term: [], medium_term: [], long_term: [] }; // Store different time ranges
let currentPeriod = 'week';

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-btn').addEventListener('click', onLoginClicked);
  document.getElementById('logout-btn').addEventListener('click', onLogout);
  document.getElementById('brand-btn').addEventListener('click', () => switchView('home'));
  
  // Mobile login button
  const mobileLoginBtn = document.getElementById('mobile-login-btn');
  if (mobileLoginBtn) {
    mobileLoginBtn.querySelector('button').addEventListener('click', onLoginClicked);
  }
  
  // Search functionality
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
  
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
  
  // Setup chart period buttons
  document.querySelectorAll('.chart-period-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const period = e.target.getAttribute('data-period');
      currentPeriod = period;
      document.querySelectorAll('.chart-period-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      renderChart();
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
  const mobileLoginBtn = document.getElementById('mobile-login-btn');
  
  if (is) {
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = '';
    if (mobileLoginBtn) mobileLoginBtn.style.display = 'none';
  } else {
    if (loginBtn) loginBtn.style.display = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (mobileLoginBtn) mobileLoginBtn.style.display = '';
  }
}

async function onLogout(){
  try{
    await fetch('/api/logout', { method: 'POST' });
  }catch(e){console.warn('logout call failed', e)}
  localStorage.removeItem('spotify_token');
  showLoggedIn(false);
  currentData = { me: null, topTracks: [], topArtists: [], playlists: [] };
  
  // Show hero section again
  const heroSection = document.getElementById('hero-section');
  if (heroSection) heroSection.style.display = '';
  
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
    
    // Fetch different time ranges for charts
    const shortTerm = await apiGet('/v1/me/top/tracks?limit=50&time_range=short_term', access_token);
    const mediumTerm = await apiGet('/v1/me/top/tracks?limit=50&time_range=medium_term', access_token);
    const longTerm = await apiGet('/v1/me/top/tracks?limit=50&time_range=long_term', access_token);
    
    const topArtists = await apiGet('/v1/me/top/artists?limit=50&time_range=medium_term', access_token);
    const playlists = await apiGet('/v1/me/playlists?limit=50', access_token);
    
    chartData = {
      short_term: shortTerm.items,
      medium_term: mediumTerm.items,
      long_term: longTerm.items
    };
    
    // Store both current (filtered) and all (unfiltered) data
    allData = {
      topTracks: mediumTerm.items,
      topArtists: topArtists.items,
      playlists: playlists.items
    };
    
    currentData = {
      me,
      topTracks: mediumTerm.items,
      topArtists: topArtists.items,
      playlists: playlists.items
    };
    
    renderProfile(me);
    renderHomeView();
    renderTopTracksView();
    renderTopArtistsView();
    renderPlaylistsView();
    renderChart();
    
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
  
  chartData = {
    short_term: demo.top_tracks || [],
    medium_term: demo.top_tracks || [],
    long_term: demo.top_tracks || []
  };
  
  allData = {
    topTracks: demo.top_tracks || [],
    topArtists: demo.top_artists || [],
    playlists: demo.playlists || []
  };
  
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
  renderChart();
  hideNotice();
}

/* ---------- Search ---------- */
function handleSearch(query){
  if (!query.trim()) {
    // Reset to all data
    currentData.topTracks = allData.topTracks;
    currentData.topArtists = allData.topArtists;
    currentData.playlists = allData.playlists;
  } else {
    const lowerQuery = query.toLowerCase();
    currentData.topTracks = allData.topTracks.filter(t => 
      t.name.toLowerCase().includes(lowerQuery) || 
      (t.artists && t.artists.some(a => a.name.toLowerCase().includes(lowerQuery)))
    );
    currentData.topArtists = allData.topArtists.filter(a => 
      a.name.toLowerCase().includes(lowerQuery)
    );
    currentData.playlists = allData.playlists.filter(p => 
      p.name.toLowerCase().includes(lowerQuery)
    );
  }
  
  // Re-render current view
  renderHomeView();
  renderTopTracksView();
  renderTopArtistsView();
  renderPlaylistsView();
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
    'charts': 'view-charts',
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
  // Hide hero section when logged in
  const heroSection = document.getElementById('hero-section');
  if (heroSection) heroSection.style.display = 'none';
  
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
    
    // Make playlist clickable to open in Spotify
    if (playlist.external_urls && playlist.external_urls.spotify) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        window.open(playlist.external_urls.spotify, '_blank');
      });
    }
    
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
    
    // Make track clickable to open in Spotify
    if (t.external_urls && t.external_urls.spotify) {
      row.addEventListener('click', () => {
        window.open(t.external_urls.spotify, '_blank');
      });
    }
    
    container.appendChild(row);
  }
}

/* ---------- Charts ---------- */
function renderChart(){
  const canvas = document.getElementById('listening-chart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = 300 * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  const width = rect.width;
  const height = 300;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  
  // Get data based on period
  let data = [];
  let labels = [];
  
  if (currentPeriod === 'week') {
    // Simulate weekly data from short term
    const tracks = chartData.short_term.slice(0, 10);
    labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    data = tracks.slice(0, 7).map((_, i) => Math.floor(Math.random() * 20) + 10);
  } else if (currentPeriod === 'month') {
    // Simulate monthly data
    labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    data = [45, 52, 48, 60];
  } else if (currentPeriod === '6months') {
    labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    data = [180, 210, 195, 230, 215, 250];
  } else if (currentPeriod === 'year') {
    labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    data = [180, 210, 195, 230, 215, 250, 240, 270, 260, 290, 280, 310];
  }
  
  // Clear canvas
  ctx.clearRect(0, 0, width, height);
  
  // Draw background
  ctx.fillStyle = 'rgba(255,255,255,0.01)';
  ctx.fillRect(padding.left, padding.top, chartWidth, chartHeight);
  
  // Calculate max value for scaling
  const maxValue = Math.max(...data);
  const scale = chartHeight / (maxValue * 1.1);
  
  // Draw grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + chartWidth, y);
    ctx.stroke();
  }
  
  // Draw axes
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + chartHeight);
  ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  ctx.stroke();
  
  // Draw line chart
  const stepX = chartWidth / (data.length - 1);
  ctx.strokeStyle = '#1db954';
  ctx.lineWidth = 3;
  ctx.beginPath();
  
  data.forEach((value, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + chartHeight - (value * scale);
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  
  // Draw gradient fill under line
  const gradient = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
  gradient.addColorStop(0, 'rgba(29, 185, 84, 0.3)');
  gradient.addColorStop(1, 'rgba(29, 185, 84, 0.0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top + chartHeight);
  data.forEach((value, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + chartHeight - (value * scale);
    ctx.lineTo(x, y);
  });
  ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
  ctx.closePath();
  ctx.fill();
  
  // Draw points
  ctx.fillStyle = '#1db954';
  data.forEach((value, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + chartHeight - (value * scale);
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  
  // Draw labels
  ctx.fillStyle = '#b3b3b3';
  ctx.font = '12px Inter, sans-serif';
  ctx.textAlign = 'center';
  labels.forEach((label, i) => {
    const x = padding.left + i * stepX;
    ctx.fillText(label, x, height - 15);
  });
  
  // Draw Y-axis labels
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const value = Math.round((maxValue * 1.1 / 4) * (4 - i));
    const y = padding.top + (chartHeight / 4) * i + 4;
    ctx.fillText(value.toString(), padding.left - 10, y);
  }
  
  // Render top items list
  renderChartTopItems();
}

function renderChartTopItems(){
  const container = document.getElementById('chart-top-items');
  if (!container) return;
  
  container.innerHTML = '';
  const tracks = currentPeriod === 'week' ? chartData.short_term.slice(0, 5) : 
                 currentPeriod === 'month' ? chartData.short_term.slice(0, 5) :
                 currentPeriod === '6months' ? chartData.medium_term.slice(0, 5) :
                 chartData.long_term.slice(0, 5);
  
  tracks.forEach((track, i) => {
    const item = el('div', {class: 'chart-item'});
    item.appendChild(el('div', {class: 'rank'}, [document.createTextNode(`${i + 1}`)]));
    
    const img = track.album && track.album.images && track.album.images[0] ? track.album.images[0].url : '';
    item.appendChild(el('img', {src: img, alt: track.name}));
    
    const meta = el('div', {class: 'meta'});
    meta.appendChild(el('div', {class: 'name'}, [document.createTextNode(track.name)]));
    const artists = (track.artists || []).map(a => a.name).join(', ');
    meta.appendChild(el('div', {class: 'artist'}, [document.createTextNode(artists)]));
    item.appendChild(meta);
    
    const trend = el('div', {class: i % 2 === 0 ? 'trend' : 'trend down'});
    trend.appendChild(el('span', {}, [document.createTextNode(i % 2 === 0 ? '↑' : '↓')]));
    item.appendChild(trend);
    
    if (track.external_urls && track.external_urls.spotify) {
      item.addEventListener('click', () => {
        window.open(track.external_urls.spotify, '_blank');
      });
    }
    
    container.appendChild(item);
  });
}

// expose small helper for debugging
window.statspotify = {loadDemo, onLoginClicked, onLogout, attemptRefresh, switchView};
