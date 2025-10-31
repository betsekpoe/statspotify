// Demo mode for StatSpotify - loads local demo data without authentication

let currentData = { me: null, topTracks: [], topArtists: [], playlists: [] };
let allData = { topTracks: [], topArtists: [], playlists: [] };
let chartData = { short_term: [], medium_term: [], long_term: [] };
let currentPeriod = 'week';
let selectedTrack = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Setup navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const view = e.target.getAttribute('data-view');
      switchView(view);
    });
  });
  
  document.querySelectorAll('.mobile-nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      const view = e.currentTarget.getAttribute('data-view');
      switchView(view);
    });
  });
  
  // Setup search
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
  
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
  
  // Load demo data
  await loadDemoData();
});

async function loadDemoData() {
  try {
    const [profile, tracks, artists, playlists] = await Promise.all([
      fetch('/demo_data/profile.json').then(r => r.json()),
      fetch('/demo_data/top_tracks.json').then(r => r.json()),
      fetch('/demo_data/top_artists.json').then(r => r.json()),
      fetch('/demo_data/playlists.json').then(r => r.json())
    ]);
    
    currentData.me = profile;
    currentData.topTracks = tracks;
    currentData.topArtists = artists;
    currentData.playlists = playlists;
    
    allData.topTracks = [...tracks];
    allData.topArtists = [...artists];
    allData.playlists = [...playlists];
    
    // Use track history data for charts
    chartData.short_term = tracks.slice(0, 10);
    chartData.medium_term = tracks.slice(0, 10);
    chartData.long_term = tracks.slice(0, 10);
    
    renderAll();
  } catch (err) {
    console.error('Failed to load demo data:', err);
    showNotice('Failed to load demo data. Please check console.');
  }
}

function renderAll() {
  renderProfile();
  renderCards();
  renderTopTracks();
  renderTopArtists();
  renderPlaylists();
  renderChart();
}

function renderProfile() {
  const area = document.getElementById('profile-area');
  if (!currentData.me) return;
  
  const img = currentData.me.images && currentData.me.images[0] ? currentData.me.images[0].url : '';
  area.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      ${img ? `<img src="${img}" style="width:32px;height:32px;border-radius:50%;object-fit:cover" />` : ''}
      <span style="font-weight:600">${currentData.me.display_name}</span>
    </div>
  `;
}

function renderCards() {
  const cards = document.getElementById('cards');
  const trackCount = currentData.topTracks.length;
  const artistCount = currentData.topArtists.length;
  const playlistCount = currentData.playlists.length;
  const totalPlays = currentData.topTracks.reduce((sum, t) => sum + (t.play_count || 0), 0);
  
  cards.innerHTML = `
    <div class="card">
      <div class="title">Top Tracks</div>
      <div class="value">${trackCount}</div>
    </div>
    <div class="card">
      <div class="title">Top Artists</div>
      <div class="value">${artistCount}</div>
    </div>
    <div class="card">
      <div class="title">Playlists</div>
      <div class="value">${playlistCount}</div>
    </div>
    <div class="card">
      <div class="title">Total Plays</div>
      <div class="value">${totalPlays.toLocaleString()}</div>
    </div>
  `;
}

function renderTopTracks() {
  const container = document.getElementById('top-tracks');
  const homeContainer = document.getElementById('home-top-tracks');
  
  if (currentData.topTracks.length === 0) {
    container.innerHTML = '<p class="notice">No tracks to display.</p>';
    homeContainer.innerHTML = '<p class="notice">No tracks to display.</p>';
    return;
  }
  
  const html = currentData.topTracks.map((track, index) => {
    const img = track.album?.images?.[0]?.url || '';
    const artistNames = track.artists.map(a => a.name).join(', ');
    // const playCount = track.play_count || 0;
    return `
      <div class="track" data-track-id="${track.id}">
        ${img ? `<img src="${img}" alt="${track.name}" />` : '<div style="width:56px;height:56px;background:#333;border-radius:6px"></div>'}
        <div class="meta">
          <div class="name">${track.name}</div>
          <div class="artist">${artistNames}</div>
        </div>
        <div class="track-rank" style="margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px">
          <span style="font-weight:700;color:#1db954">#${index + 1}</span>
          <!-- <span style="font-size:12px;color:#b3b3b3">${playCount} plays</span> -->
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
  homeContainer.innerHTML = currentData.topTracks.slice(0, 5).map((track, index) => {
    const img = track.album?.images?.[0]?.url || '';
    const artistNames = track.artists.map(a => a.name).join(', ');
    // const playCount = track.play_count || 0;
    return `
      <div class="track" data-track-id="${track.id}">
        ${img ? `<img src="${img}" alt="${track.name}" />` : '<div style="width:56px;height:56px;background:#333;border-radius:6px"></div>'}
        <div class="meta">
          <div class="name">${track.name}</div>
          <div class="artist">${artistNames}</div>
        </div>
        <div class="track-rank" style="margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:2px">
          <span style="font-weight:700;color:#1db954">#${index + 1}</span>
          <!-- <span style="font-size:12px;color:#b3b3b3">${playCount} plays</span> -->
        </div>
      </div>
    `;
  }).join('');
  
  // Add click handlers for chart view
  document.querySelectorAll('.track[data-track-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      const trackId = el.getAttribute('data-track-id');
      const track = currentData.topTracks.find(t => t.id === trackId);
      if (track) {
        // If in charts view, select track for chart focus
        const activeView = document.querySelector('.view-section.active');
        if (activeView && activeView.id === 'view-charts') {
          selectTrackForChart(track);
        } else {
          // Otherwise open in Spotify
          if (track.external_urls && track.external_urls.spotify) {
            window.open(track.external_urls.spotify, '_blank');
          }
        }
      }
    });
  });
}

function renderTopArtists() {
  const container = document.getElementById('top-artists');
  
  if (currentData.topArtists.length === 0) {
    container.innerHTML = '<p class="notice">No artists to display.</p>';
    return;
  }
  
  const html = currentData.topArtists.map(artist => {
    const img = artist.images?.[0]?.url || '';
    const followers = artist.followers?.total?.toLocaleString() || '0';
    return `
      <div class="artist-card" onclick="window.open('${artist.external_urls?.spotify || '#'}', '_blank')">
        ${img ? `<img src="${img}" alt="${artist.name}" />` : '<div style="width:100%;aspect-ratio:1;background:#333;border-radius:50%"></div>'}
        <div class="name">${artist.name}</div>
        <div class="followers">${followers} followers</div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
}

function renderPlaylists() {
  const container = document.getElementById('playlists');
  
  if (currentData.playlists.length === 0) {
    container.innerHTML = '<p class="notice">No playlists to display.</p>';
    return;
  }
  
  const html = currentData.playlists.map(playlist => {
    const img = playlist.images?.[0]?.url || '';
    const trackCount = playlist.tracks?.total || 0;
    return `
      <div class="playlist-card" onclick="window.open('${playlist.external_urls?.spotify || '#'}', '_blank')">
        ${img ? `<img src="${img}" alt="${playlist.name}" />` : '<div style="width:100%;aspect-ratio:1;background:#333;border-radius:8px"></div>'}
        <div class="name">${playlist.name}</div>
        <div class="track-count">${trackCount} tracks</div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
}

function selectTrackForChart(track) {
  selectedTrack = track;
  
  // Update chart title
  const chartTitle = document.getElementById('chart-title');
  chartTitle.textContent = `${track.name} - Play History`;
  
  renderChart();
}

function renderChart() {
  const canvas = document.getElementById('listening-chart');
  const ctx = canvas.getContext('2d');
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  let data, labels;
  
  if (selectedTrack && selectedTrack.history && selectedTrack.history[currentPeriod]) {
    // Show selected track's history
    data = selectedTrack.history[currentPeriod];
    labels = data.map((_, i) => i + 1);
  } else if (chartData[getPeriodKey()].length > 0) {
    // Show aggregated top tracks data
    const periodKey = getPeriodKey();
    const tracks = chartData[periodKey] || [];
    
    if (tracks.length === 0 || !tracks[0].history) {
      renderNoDataMessage(ctx, canvas);
      return;
    }
    
    // Aggregate play counts across top tracks
    const firstTrack = tracks[0];
    const historyLength = firstTrack.history[currentPeriod]?.length || 7;
    data = new Array(historyLength).fill(0);
    
    tracks.slice(0, 5).forEach(track => {
      if (track.history && track.history[currentPeriod]) {
        track.history[currentPeriod].forEach((count, i) => {
          data[i] += count;
        });
      }
    });
    
    labels = data.map((_, i) => i + 1);
  } else {
    renderNoDataMessage(ctx, canvas);
    return;
  }
  
  drawLineChart(ctx, canvas, data, labels);
  renderChartTopItems();
}

function renderNoDataMessage(ctx, canvas) {
  ctx.fillStyle = '#b3b3b3';
  ctx.font = '16px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('No data available. Play songs to load history.', canvas.width / 2, canvas.height / 2);
}

function drawLineChart(ctx, canvas, data, labels) {
  const padding = 40;
  const chartWidth = canvas.width - padding * 2;
  const chartHeight = canvas.height - padding * 2;
  
  const maxValue = Math.max(...data, 10);
  const stepX = chartWidth / (data.length - 1 || 1);
  const stepY = chartHeight / maxValue;
  
  // Draw grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = padding + (chartHeight / 5) * i;
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(canvas.width - padding, y);
    ctx.stroke();
  }
  
  // Draw line with gradient
  ctx.beginPath();
  ctx.moveTo(padding, canvas.height - padding - data[0] * stepY);
  
  for (let i = 1; i < data.length; i++) {
    const x = padding + stepX * i;
    const y = canvas.height - padding - data[i] * stepY;
    ctx.lineTo(x, y);
  }
  
  ctx.strokeStyle = '#1db954';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Fill area under line
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.lineTo(padding, canvas.height - padding);
  ctx.closePath();
  
  const gradient = ctx.createLinearGradient(0, padding, 0, canvas.height - padding);
  gradient.addColorStop(0, 'rgba(29, 185, 84, 0.3)');
  gradient.addColorStop(1, 'rgba(29, 185, 84, 0)');
  ctx.fillStyle = gradient;
  ctx.fill();
  
  // Draw points
  ctx.fillStyle = '#1db954';
  for (let i = 0; i < data.length; i++) {
    const x = padding + stepX * i;
    const y = canvas.height - padding - data[i] * stepY;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Draw axes labels
  ctx.fillStyle = '#b3b3b3';
  ctx.font = '12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  
  // X-axis labels (show fewer labels for readability)
  const labelStep = Math.ceil(data.length / 7);
  for (let i = 0; i < data.length; i += labelStep) {
    const x = padding + stepX * i;
    ctx.fillText(labels[i], x, canvas.height - padding + 20);
  }
  
  // Y-axis labels
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const y = padding + (chartHeight / 5) * i;
    const value = Math.round(maxValue * (1 - i / 5));
    ctx.fillText(value.toString(), padding - 10, y + 4);
  }
}

function renderChartTopItems() {
  const container = document.getElementById('chart-top-items');
  
  if (selectedTrack) {
    // Show only selected track
    const img = selectedTrack.album?.images?.[0]?.url || '';
    const artistNames = selectedTrack.artists.map(a => a.name).join(', ');
    const playCount = selectedTrack.play_count || 0;
    
    container.innerHTML = `
      <div class="chart-item">
        <span class="rank">#1</span>
        ${img ? `<img src="${img}" alt="${selectedTrack.name}" />` : '<div style="width:48px;height:48px;background:#333;border-radius:6px"></div>'}
        <div class="meta">
          <div class="name">${selectedTrack.name}</div>
          <div class="artist">${artistNames}</div>
        </div>
        <div class="trend">
          <!-- <span>${playCount} plays</span> -->
        </div>
      </div>
      <button class="btn" onclick="clearTrackSelection()" style="margin-top:12px;width:100%">Show All Tracks</button>
    `;
  } else {
    // Show top tracks
    const html = currentData.topTracks.slice(0, 10).map((track, i) => {
      const img = track.album?.images?.[0]?.url || '';
      const artistNames = track.artists.map(a => a.name).join(', ');
      const playCount = track.play_count || 0;
      const trend = i < 3 ? 'up' : i > 7 ? 'down' : '';
      
      return `
        <div class="chart-item" data-track-id="${track.id}" style="cursor:pointer">
          <span class="rank">#${i + 1}</span>
          ${img ? `<img src="${img}" alt="${track.name}" />` : '<div style="width:48px;height:48px;background:#333;border-radius:6px"></div>'}
          <div class="meta">
            <div class="name">${track.name}</div>
            <div class="artist">${artistNames}</div>
          </div>
          <div class="trend ${trend}">
            <!-- <span>${playCount} plays</span> -->
          </div>
        </div>
      `;
    }).join('');
    
    container.innerHTML = html;
    
    // Add click handlers
    container.querySelectorAll('.chart-item[data-track-id]').forEach(el => {
      el.addEventListener('click', () => {
        const trackId = el.getAttribute('data-track-id');
        const track = currentData.topTracks.find(t => t.id === trackId);
        if (track) {
          selectTrackForChart(track);
        }
      });
    });
  }
}

window.clearTrackSelection = function() {
  selectedTrack = null;
  const chartTitle = document.getElementById('chart-title');
  chartTitle.textContent = 'Top Tracks Over Time';
  renderChart();
};

function getPeriodKey() {
  if (currentPeriod === 'week') return 'short_term';
  if (currentPeriod === 'month') return 'medium_term';
  return 'long_term';
}

function switchView(viewName) {
  // Remove active from all views and nav items
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(n => n.classList.remove('active'));
  
  // Activate target view
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) {
    targetView.classList.add('active');
  }
  
  // Activate nav item
  document.querySelectorAll(`[data-view="${viewName}"]`).forEach(n => n.classList.add('active'));
  
  // If switching to charts, render chart
  if (viewName === 'charts') {
    renderChart();
  }
}

function handleSearch(query) {
  if (!query) {
    currentData.topTracks = [...allData.topTracks];
    currentData.topArtists = [...allData.topArtists];
    currentData.playlists = [...allData.playlists];
  } else {
    const q = query.toLowerCase();
    currentData.topTracks = allData.topTracks.filter(t => 
      t.name.toLowerCase().includes(q) || 
      t.artists.some(a => a.name.toLowerCase().includes(q))
    );
    currentData.topArtists = allData.topArtists.filter(a => 
      a.name.toLowerCase().includes(q)
    );
    currentData.playlists = allData.playlists.filter(p => 
      p.name.toLowerCase().includes(q)
    );
  }
  
  renderTopTracks();
  renderTopArtists();
  renderPlaylists();
}

function showNotice(msg) {
  console.log(msg);
}
