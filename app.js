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

let currentData = { me: null, topTracks: [], topArtists: [], playlists: [] };
let allData = { topTracks: [], topArtists: [], playlists: [] }; // Store unfiltered data for search
let chartData = { short_term: [], medium_term: [], long_term: [] }; // Store different time ranges
let currentPeriod = 'week';
let selectedTrackForChart = null; // Track selected for chart focus

document.addEventListener('DOMContentLoaded', () => {
  // Show loading spinner initially
  showLoading();
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
  
  // Setup back button from track details
  document.getElementById('back-from-track').addEventListener('click', () => {
    switchView('home');
  });
  
  // Initialize UI state as logged out
  showLoggedIn(false);
  
  const params = new URLSearchParams(window.location.search);
  if (params.get('code')) {
    handleRedirect();
  } else {
    // try to use access token from storage
    const token = getStoredToken();
    if (token) {
      fetchAndRender(token);
    } else {
      // Only attempt server-side refresh if we're in production (has /api endpoints)
      // For new users or local dev, just hide loading and show login screen
      const isProduction = window.location.hostname !== 'localhost' && 
                          window.location.hostname !== '127.0.0.1' &&
                          !window.location.port;
      
      if (isProduction) {
        attemptRefresh();
      } else {
        hideLoading();
        hideNotice();
      }
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
    hideLoading();
    return;
  }
  showNotice('Exchanging code for token...');
  try {
    // Try server-side exchange first (for production)
    const resp = await fetch('/api/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: REDIRECT_URI })
    });
    
    // If server endpoint exists and returns success
    if (resp.ok) {
      const tokenObj = await resp.json();
      if (tokenObj.error) {
        showNotice('Token exchange returned an error: ' + (tokenObj.error_description || tokenObj.error));
        console.error('token error', tokenObj);
        hideLoading();
        return;
      }
      storeToken(tokenObj);
      fetchAndRender(tokenObj);
      return;
    }
    
    // Fallback: Direct client-side exchange (for local development)
    console.log('Server exchange not available, using direct exchange (local dev)');
    showNotice('Exchanging code directly (local mode)...');
    
    const directResp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier
      })
    });
    
    if (!directResp.ok) {
      const errorText = await directResp.text();
      showNotice('Token exchange failed. Try again.');
      console.error('Direct token exchange error', directResp.status, errorText);
      hideLoading();
      return;
    }
    
    const tokenObj = await directResp.json();
    if (tokenObj.error) {
      showNotice('Token exchange returned an error: ' + (tokenObj.error_description || tokenObj.error));
      console.error('token error', tokenObj);
      hideLoading();
      return;
    }
    
    storeToken(tokenObj);
    fetchAndRender(tokenObj);
    
  } catch (err) {
    console.error(err);
    showNotice('Token exchange failed. Check console for details.');
    hideLoading();
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
  // Don't show "Checking session..." message to avoid confusion for new users
  try{
    // Add a timeout to prevent infinite loading
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
    
    const resp = await fetch('/api/refresh', { 
      method: 'POST',
      signal: controller.signal 
    });
    clearTimeout(timeoutId);
    
    if (!resp.ok) {
      // no active session or refresh failed (expected for new users)
      console.log('No server session available');
      hideNotice();
      hideLoading();
      return null;
    }
    const tokenObj = await resp.json();
    if (tokenObj && tokenObj.access_token) {
      storeToken(tokenObj);
      fetchAndRender(tokenObj);
      // show logout button
      showLoggedIn(true);
      return tokenObj;
    } else {
      hideNotice();
      hideLoading();
    }
  }catch(err){
    // Expected error for new users or timeout
    if (err.name === 'AbortError') {
      console.log('Session check timeout - no active session');
    } else {
      console.log('Server refresh not available');
    }
    hideNotice();
    hideLoading();
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
    if (mobileLoginBtn) mobileLoginBtn.style.display = 'block';
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
  showNotice('Loading your Spotify stats...');
  showLoading();
  
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
    hideLoading();
    showLoggedIn(true);
  }catch(err){
    console.error('Fetch error:', err);
    hideLoading();
    showNotice('Failed to fetch Spotify data. Please try logging in again.');
    showLoggedIn(false);
    // Clear invalid token
    localStorage.removeItem('spotify_token');
  }
}

async function apiGet(path, access_token){
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
  
  try {
    const resp = await fetch('https://api.spotify.com' + path, {
      headers: {Authorization: 'Bearer ' + access_token},
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`API error ${resp.status}: ${errorText}`);
    }
    return await resp.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timeout - Spotify API is not responding');
    }
    throw err;
  }
}

/* ---------- Search ---------- */
let searchTimeout = null;

async function handleSearch(query){
  clearTimeout(searchTimeout);
  
  if (!query.trim()) {
    // Reset to all data and show cards
    currentData.topTracks = allData.topTracks;
    currentData.topArtists = allData.topArtists;
    currentData.playlists = allData.playlists;
    document.getElementById('cards').style.display = '';
    
    // Re-render current view
    renderHomeView();
    renderTopTracksView();
    renderTopArtistsView();
    renderPlaylistsView();
    return;
  }
  
  // Hide cards when searching
  const cardsEl = document.getElementById('cards');
  if (cardsEl) cardsEl.style.display = 'none';
  
  const token = getStoredToken();
  if (!token) {
    // No token, just filter local data
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
    
    renderHomeView();
    renderTopTracksView();
    renderTopArtistsView();
    renderPlaylistsView();
    return;
  }
  
  // Debounce Spotify API search
  searchTimeout = setTimeout(async () => {
    try {
      const results = await apiGet(`/v1/search?q=${encodeURIComponent(query)}&type=track,artist&limit=20`, token.access_token);
      
      currentData.topTracks = results.tracks ? results.tracks.items : [];
      currentData.topArtists = results.artists ? results.artists.items : [];
      
      renderHomeView();
      renderTopTracksView();
      renderTopArtistsView();
    } catch (err) {
      console.error('Search error:', err);
      // Fallback to local filtering
      const lowerQuery = query.toLowerCase();
      currentData.topTracks = allData.topTracks.filter(t => 
        t.name.toLowerCase().includes(lowerQuery) || 
        (t.artists && t.artists.some(a => a.name.toLowerCase().includes(lowerQuery)))
      );
      currentData.topArtists = allData.topArtists.filter(a => 
        a.name.toLowerCase().includes(lowerQuery)
      );
      
      renderHomeView();
      renderTopTracksView();
      renderTopArtistsView();
    }
  }, 300);
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
  
  // If switching to charts view, auto-load weekly stats
  if (view === 'charts') {
    currentPeriod = 'week';
    document.querySelectorAll('.chart-period-btn').forEach(b => b.classList.remove('active'));
    const weekBtn = document.querySelector('.chart-period-btn[data-period="week"]');
    if (weekBtn) weekBtn.classList.add('active');
    renderChart();
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
  
  if (me.images && me.images[0]) {
    // User has a profile picture
    const img = el('img', {src: me.images[0].url});
    area.appendChild(img);
  } else {
    // No profile picture - show first letter of name
    const displayName = me.display_name || me.name || 'User';
    const initial = displayName.charAt(0).toUpperCase();
    const initialDiv = el('div', {class: 'profile-initial'}, [document.createTextNode(initial)]);
    area.appendChild(initialDiv);
  }
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
  for (let i = 0; i < tracks.length; i++){
    const t = tracks[i];
    const row = el('div',{class:'track'});
    const img = t.album && t.album.images && t.album.images[0] ? t.album.images[0].url : (t.image || '');
    row.appendChild(el('img',{src:img,alt:t.name}));
    const meta = el('div',{class:'meta'});
    meta.appendChild(el('div',{class:'name'},[document.createTextNode(t.name)]));
    const artists = (t.artists || t.artists || []).map(a=>a.name).join(', ') || t.artist || '';
    meta.appendChild(el('div',{class:'artist'},[document.createTextNode(artists)]));
    row.appendChild(meta);
    
    // Add play count and rank
    const rankDiv = el('div', {class: 'track-rank', style: 'margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px'});
    rankDiv.appendChild(el('span', {style: 'font-weight:700;color:#1db954'}, [document.createTextNode(`#${i + 1}`)]));
    
    // Mock play count (in real app, would come from API)
    // const playCount = t.play_count || Math.floor(Math.random() * 200) + 50;
    // rankDiv.appendChild(el('span', {style: 'font-size:12px;color:#b3b3b3'}, [document.createTextNode(`${playCount} plays`)]));
    row.appendChild(rankDiv);
    
    container.appendChild(row);
  }
}

function renderTracks(tracks, containerId){
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < tracks.length; i++){
    const t = tracks[i];
    const row = el('div',{class:'track'});
    const img = t.album && t.album.images && t.album.images[0] ? t.album.images[0].url : (t.image || '');
    row.appendChild(el('img',{src:img,alt:t.name}));
    const meta = el('div',{class:'meta'});
    meta.appendChild(el('div',{class:'name'},[document.createTextNode(t.name)]));
    const artists = (t.artists || []).map(a=>a.name).join(', ') || t.artist || '';
    meta.appendChild(el('div',{class:'artist'},[document.createTextNode(artists)]));
    row.appendChild(meta);
    
    // Add play count
    // const playCount = t.play_count || Math.floor(Math.random() * 200) + 50;
    // const countDiv = el('div', {style: 'margin-left:auto;font-size:12px;color:#b3b3b3'});
    // countDiv.appendChild(document.createTextNode(`${playCount} plays`));
    // row.appendChild(countDiv);
    
    // Make track clickable to show details
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      showTrackDetails(t);
    });
    
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
  
  // If a track is selected, show its data
  if (selectedTrackForChart) {
    // Check if track has history data
    if (selectedTrackForChart.history && selectedTrackForChart.history[currentPeriod]) {
      data = selectedTrackForChart.history[currentPeriod];
      
      // Generate labels based on period
      if (currentPeriod === 'week') {
        labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      } else if (currentPeriod === 'month') {
        labels = Array.from({length: data.length}, (_, i) => `Day ${i + 1}`);
      } else if (currentPeriod === '6months') {
        labels = Array.from({length: data.length}, (_, i) => `Week ${i + 1}`);
      } else if (currentPeriod === 'year') {
        labels = Array.from({length: data.length}, (_, i) => `Week ${i + 1}`);
      }
    } else {
      // Track doesn't have history data
      ctx.fillStyle = '#b3b3b3';
      ctx.font = '16px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No data available for this track.', width / 2, height / 2);
      return;
    }
  } else if (currentPeriod === 'week') {
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
    
    // In charts view, clicking a track selects it for the chart
    const activeView = document.querySelector('.view-section.active');
    if (activeView && activeView.id === 'view-charts') {
      item.addEventListener('click', () => {
        selectTrackForChart(track);
      });
    } else if (track.external_urls && track.external_urls.spotify) {
      item.addEventListener('click', () => {
        window.open(track.external_urls.spotify, '_blank');
      });
    }
    
    container.appendChild(item);
  });
}

/* ---------- Loading Overlay ---------- */
function showLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
  }
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.classList.add('hidden');
  }
}

/* ---------- Track Selection for Chart ---------- */
function selectTrackForChart(track) {
  selectedTrackForChart = track;
  const chartTitle = document.getElementById('chart-title');
  if (chartTitle) {
    chartTitle.textContent = `${track.name} - Play History`;
  }
  renderChart();
  
  // Update the top items list to show clear button
  const container = document.getElementById('chart-top-items');
  if (container && track) {
    const img = track.album && track.album.images && track.album.images[0] ? track.album.images[0].url : '';
    const artists = (track.artists || []).map(a => a.name).join(', ');
    container.innerHTML = `
      <div class="chart-item">
        <span class="rank">#1</span>
        ${img ? `<img src="${img}" alt="${track.name}" />` : ''}
        <div class="meta">
          <div class="name">${track.name}</div>
          <div class="artist">${artists}</div>
        </div>
        <div class="trend">
          <span>Selected</span>
        </div>
      </div>
      <button class="btn" id="clear-track-selection" style="margin-top:12px;width:100%">Show All Tracks</button>
    `;
    
    document.getElementById('clear-track-selection').addEventListener('click', clearTrackSelection);
  }
}

function clearTrackSelection() {
  selectedTrackForChart = null;
  const chartTitle = document.getElementById('chart-title');
  if (chartTitle) {
    chartTitle.textContent = 'Top Tracks Over Time';
  }
  renderChart();
}

/* ---------- Track Details View ---------- */
async function showTrackDetails(track) {
  showLoading();
  switchView('track-details');
  
  try {
    const token = getStoredToken();
    if (!token) {
      showNotice('Please log in to view track details');
      hideLoading();
      return;
    }
    
    // Fetch audio features
    const features = await apiGet(`/v1/audio-features/${track.id}`, token.access_token);
    const trackInfo = await apiGet(`/v1/tracks/${track.id}`, token.access_token);
    
    // Populate basic info
    const img = trackInfo.album?.images?.[0]?.url || '';
    document.getElementById('track-detail-image').src = img;
    document.getElementById('track-detail-name').textContent = trackInfo.name;
    document.getElementById('track-detail-artist').textContent = trackInfo.artists.map(a => a.name).join(', ');
    document.getElementById('track-detail-album').textContent = trackInfo.album.name;
    
    // Duration
    const minutes = Math.floor(trackInfo.duration_ms / 60000);
    const seconds = ((trackInfo.duration_ms % 60000) / 1000).toFixed(0);
    document.getElementById('track-detail-duration').textContent = `${minutes}:${seconds.padStart(2, '0')}`;
    
    // Release date
    const releaseYear = trackInfo.album.release_date.split('-')[0];
    document.getElementById('track-detail-release').textContent = releaseYear;
    
    // Popularity score
    const popularity = trackInfo.popularity;
    document.getElementById('track-popularity').textContent = popularity;
    document.getElementById('popularity-fill').style.width = popularity + '%';
    
    let popularityDesc = '';
    if (popularity >= 80) popularityDesc = '🔥 Extremely popular! This is a major hit.';
    else if (popularity >= 60) popularityDesc = '⭐ Very popular track with strong listener engagement.';
    else if (popularity >= 40) popularityDesc = '👍 Moderately popular with a solid fanbase.';
    else if (popularity >= 20) popularityDesc = '🎵 Niche appeal, loved by dedicated fans.';
    else popularityDesc = '💎 Hidden gem waiting to be discovered.';
    document.getElementById('popularity-description').textContent = popularityDesc;
    
    // Audio features
    if (features) {
      // Tempo
      const tempo = Math.round(features.tempo);
      document.getElementById('track-tempo').textContent = `${tempo} BPM`;
      const tempoPercent = Math.min(100, (tempo / 200) * 100);
      document.getElementById('tempo-fill').style.width = tempoPercent + '%';
      
      // Key
      const keys = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'];
      const key = keys[features.key] || 'Unknown';
      const mode = features.mode === 1 ? 'Major' : 'Minor';
      document.getElementById('track-key').textContent = key;
      document.getElementById('track-mode').textContent = mode;
      
      // Danceability
      const danceability = Math.round(features.danceability * 100);
      document.getElementById('track-danceability').textContent = `${danceability}%`;
      document.getElementById('danceability-fill').style.width = danceability + '%';
      
      // Energy
      const energy = Math.round(features.energy * 100);
      document.getElementById('track-energy').textContent = `${energy}%`;
      document.getElementById('energy-fill').style.width = energy + '%';
      
      // Valence (happiness)
      const valence = Math.round(features.valence * 100);
      document.getElementById('track-valence').textContent = `${valence}%`;
      document.getElementById('valence-fill').style.width = valence + '%';
      
      // Speechiness
      const speechiness = Math.round(features.speechiness * 100);
      document.getElementById('track-speechiness').textContent = `${speechiness}%`;
      document.getElementById('speechiness-fill').style.width = speechiness + '%';
      
      // Acousticness
      const acousticness = Math.round(features.acousticness * 100);
      document.getElementById('track-acousticness').textContent = `${acousticness}%`;
      document.getElementById('acousticness-fill').style.width = acousticness + '%';
      
      // Liveness
      const liveness = Math.round(features.liveness * 100);
      document.getElementById('track-liveness').textContent = `${liveness}%`;
      document.getElementById('liveness-fill').style.width = liveness + '%';
      
      // Mood classification
      let mood = '';
      if (energy > 60 && valence > 60) mood = '🎉 High-Energy Happy Song';
      else if (energy > 60 && valence <= 60) mood = '⚡ High-Energy Sad Song';
      else if (energy <= 60 && valence > 60) mood = '😌 Calm Happy Song';
      else mood = '😔 Calm Sad Song';
      document.getElementById('mood-classification').textContent = mood;
      
      // Draw mood quadrant
      drawMoodQuadrant(valence / 100, energy / 100);
      
      // Generate insights
      generateInsights(features, trackInfo);
    }
    
    hideLoading();
  } catch (err) {
    console.error('Error fetching track details:', err);
    showNotice('Failed to load track details. Please try again.');
    hideLoading();
    switchView('home');
  }
}

function drawMoodQuadrant(valence, energy) {
  const canvas = document.getElementById('mood-chart');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  const size = 300;
  ctx.clearRect(0, 0, size, size);
  
  // Draw quadrant lines
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();
  
  // Draw background quadrants
  ctx.fillStyle = 'rgba(29,185,84,0.05)';
  ctx.fillRect(size / 2, 0, size / 2, size / 2); // Happy + Energetic
  
  // Calculate position (valence = x, energy = y, but inverted)
  const x = valence * size;
  const y = (1 - energy) * size;
  
  // Draw connecting lines to axes
  ctx.strokeStyle = 'rgba(29,185,84,0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, size / 2);
  ctx.moveTo(x, y);
  ctx.lineTo(size / 2, y);
  ctx.stroke();
  ctx.setLineDash([]);
  
  // Draw point
  ctx.fillStyle = '#1db954';
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fill();
  
  // Draw glow
  ctx.fillStyle = 'rgba(29,185,84,0.3)';
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fill();
}

function generateInsights(features, trackInfo) {
  const insights = [];
  
  // Tempo insights
  if (features.tempo > 140) {
    insights.push({ icon: '🏃', text: `At ${Math.round(features.tempo)} BPM, this is perfect for high-intensity workouts or running!` });
  } else if (features.tempo < 80) {
    insights.push({ icon: '🧘', text: `With a slow tempo of ${Math.round(features.tempo)} BPM, this is ideal for relaxation or meditation.` });
  }
  
  // Danceability
  if (features.danceability > 0.8) {
    insights.push({ icon: '💃', text: `This track is ${Math.round(features.danceability * 100)}% danceable - it's impossible not to move to this!` });
  }
  
  // Energy vs Valence mismatch
  if (features.energy > 0.7 && features.valence < 0.3) {
    insights.push({ icon: '🎸', text: 'This is an energetic yet emotional track - perfect for cathartic moments.' });
  } else if (features.energy < 0.3 && features.valence > 0.7) {
    insights.push({ icon: '☀️', text: 'A calm but happy song - great for peaceful, content moments.' });
  }
  
  // Speechiness
  if (features.speechiness > 0.66) {
    insights.push({ icon: '🎤', text: 'Heavy on the lyrics! This track is very speech-like, possibly rap or poetry.' });
  } else if (features.speechiness > 0.33) {
    insights.push({ icon: '🗣️', text: 'Good balance of vocals and instrumentals.' });
  }
  
  // Acousticness
  if (features.acousticness > 0.8) {
    insights.push({ icon: '🎸', text: 'Highly acoustic - this has that raw, organic sound.' });
  } else if (features.acousticness < 0.2) {
    insights.push({ icon: '🎹', text: 'Heavily produced with electronic elements dominating the sound.' });
  }
  
  // Liveness
  if (features.liveness > 0.8) {
    insights.push({ icon: '🎪', text: 'Strong live performance vibes - might be recorded with an audience!' });
  }
  
  // Key insights
  const keyModes = {
    0: 'C', 2: 'D', 4: 'E', 5: 'F', 7: 'G', 9: 'A', 11: 'B'
  };
  if (keyModes[features.key]) {
    const keyName = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B'][features.key];
    const mode = features.mode === 1 ? 'Major' : 'Minor';
    insights.push({ icon: '🎼', text: `Written in ${keyName} ${mode} - ${mode === 'Minor' ? 'often associated with emotional or melancholic feelings' : 'typically bright and uplifting'}.` });
  }
  
  // Render insights
  const container = document.getElementById('track-insights');
  container.innerHTML = '';
  insights.forEach(insight => {
    const item = el('div', { class: 'insight-item' });
    item.appendChild(el('div', { class: 'insight-icon' }, [document.createTextNode(insight.icon)]));
    item.appendChild(el('div', { class: 'insight-text' }, [document.createTextNode(insight.text)]));
    container.appendChild(item);
  });
  
  if (insights.length === 0) {
    container.innerHTML = '<p style="color:var(--muted);text-align:center;">No special insights for this track.</p>';
  }
}

// expose small helper for debugging
window.statspotify = {onLoginClicked, onLogout, attemptRefresh, switchView, showTrackDetails};
