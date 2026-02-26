const TOKEN_KEY = 'resenha-player-token';

const els = {
  tabs: Array.prototype.slice.call(document.querySelectorAll('.tab')),
  perfil: document.getElementById('perfil'),
  tabela: document.getElementById('tabela'),
  refreshBtn: document.getElementById('refreshBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  pendingBox: document.getElementById('pendingBox'),
  pendingText: document.getElementById('pendingText'),
  mainAvatar: document.getElementById('mainAvatar'),
  mainName: document.getElementById('mainName'),
  mainTeam: document.getElementById('mainTeam'),
  mainStats: document.getElementById('mainStats'),
  teammatesList: document.getElementById('teammatesList'),
  matchesTable: document.getElementById('matchesTable')
};

bindEvents();
bootstrap();

function bindEvents() {
  els.tabs.forEach(function (tabEl) {
    tabEl.addEventListener('click', function () {
      showTab(tabEl.getAttribute('data-tab'));
    });
  });

  if (els.refreshBtn) {
    els.refreshBtn.addEventListener('click', function () {
      loadHome().catch(function (err) {
        console.error('Erro ao atualizar home do jogador:', err);
      });
    });
  }

  if (els.logoutBtn) {
    els.logoutBtn.addEventListener('click', function () {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/player';
    });
  }
}

async function bootstrap() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.href = '/player';
    return;
  }

  try {
    await loadHome();
  } catch (err) {
    console.error('Erro no bootstrap da home do jogador:', err);
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/player';
  }
}

function showTab(tab) {
  if (!els.perfil || !els.tabela) return;
  els.perfil.classList.add('hidden');
  els.tabela.classList.add('hidden');
  els.tabs.forEach(function (t) { t.classList.remove('active'); });

  if (tab === 'tabela') {
    els.tabela.classList.remove('hidden');
    setActiveTab('tabela');
  } else {
    els.perfil.classList.remove('hidden');
    setActiveTab('perfil');
  }
}

function setActiveTab(tab) {
  els.tabs.forEach(function (t) {
    if (t.getAttribute('data-tab') === tab) t.classList.add('active');
  });
}

async function loadHome() {
  const token = localStorage.getItem(TOKEN_KEY);
  const data = await api('/api/player/home', { headers: { Authorization: 'Bearer ' + token } });

  if (!data.linked) {
    if (els.pendingBox) els.pendingBox.classList.remove('hidden');
    if (els.pendingText) els.pendingText.textContent = data.message || 'Aguardando vinculo no painel.';
    renderProfile({
      name: data.user && data.user.name ? data.user.name : 'Jogador',
      teamName: 'Sem time',
      photoDataUrl: '',
      assists: 0,
      teamGoalsFor: 0,
      teamGoalsAgainst: 0,
      yellowCards: 0,
      redCards: 0
    });
    renderTeammates([]);
    renderMatches([]);
    return;
  }

  if (els.pendingBox) els.pendingBox.classList.add('hidden');

  renderProfile({
    name: (data.player && data.player.name) || (data.user && data.user.name) || 'Jogador',
    teamName: (data.team && data.team.name) || 'Sem time',
    photoDataUrl: (data.player && data.player.photoDataUrl) || '',
    assists: (data.player && data.player.assists) || 0,
    teamGoalsFor: (data.teamStats && data.teamStats.goalsFor) || 0,
    teamGoalsAgainst: (data.teamStats && data.teamStats.goalsAgainst) || 0,
    yellowCards: (data.player && data.player.yellowCards) || 0,
    redCards: (data.player && data.player.redCards) || 0
  });

  renderTeammates(Array.isArray(data.teammates) ? data.teammates : []);
  renderMatches(Array.isArray(data.matches) ? data.matches : []);
}

function renderProfile(profile) {
  if (els.mainAvatar) els.mainAvatar.src = profile.photoDataUrl || avatarFallback(profile.name, 96);
  if (els.mainName) els.mainName.textContent = profile.name;
  if (els.mainTeam) els.mainTeam.textContent = profile.teamName;
  if (els.mainStats) {
    els.mainStats.innerHTML = [
      statBox(profile.assists, 'A'),
      statBox(profile.teamGoalsFor, 'GP'),
      statBox(profile.teamGoalsAgainst, 'GC'),
      statBox(profile.yellowCards, 'CA'),
      statBox(profile.redCards, 'CV')
    ].join('');
  }
}

function renderTeammates(list) {
  if (!els.teammatesList) return;
  if (!list.length) {
    els.teammatesList.innerHTML = '<div class="empty-state">Nenhum companheiro de time.</div>';
    return;
  }
  els.teammatesList.innerHTML = list.map(function (m) {
    const photo = m.photoDataUrl || avatarFallback(m.name, 34);
    return '<div class="player-item">' +
      '<div class="player-left">' +
      '<img class="player-avatar" src="' + esc(photo) + '" alt="' + esc(m.name) + '">' +
      '<div class="player-name">' + esc(m.name) + (m.isMe ? ' (voce)' : '') + '</div>' +
      '</div>' +
      '<div class="player-stats">' +
      '<span>GP ' + Number(m.goals || 0) + '</span><span>A ' + Number(m.assists || 0) + '</span><span>CA ' + Number(m.yellowCards || 0) + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
}

function renderMatches(list) {
  if (!els.matchesTable) return;
  if (!list.length) {
    els.matchesTable.innerHTML = '<div class="empty-state">Nenhum jogo encontrado para o seu time.</div>';
    return;
  }

  els.matchesTable.innerHTML = list.map(function (m) {
    const playerStats = m.playerStats || {};
    const dateLabel = m.date ? formatDate(m.date) : 'Sem data';
    const title = m.stage || 'Pelada';
    const score = esc(m.teamAName || 'Time A') + ' ' + Number(m.goalsA || 0) + ' x ' + Number(m.goalsB || 0) + ' ' + esc(m.teamBName || 'Time B');
    return '<div class="match">' +
      '<div class="match-header"><span>' + dateLabel + '</span><span>' + esc(title) + '</span></div>' +
      '<div class="score">' + score + '</div>' +
      '<div class="match-stats">' +
      '<span>⚽ GP: ' + Number(playerStats.goals || 0) + '</span>' +
      '<span>🅰 A: ' + Number(playerStats.assists || 0) + '</span>' +
      '<span>🟨 CA: ' + Number(playerStats.yellowCards || 0) + '</span>' +
      '<span>🟥 CV: ' + Number(playerStats.redCards || 0) + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
}

function statBox(value, label) {
  return '<div class="stat"><div class="value">' + (Number(value) || 0) + '</div><div class="label">' + label + '</div></div>';
}

function formatDate(v) {
  if (!v) return 'Sem data';
  var parts = String(v).split('-');
  if (parts.length !== 3) return String(v);
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function avatarFallback(name, size) {
  var initials = String(name || 'J').split(/\s+/).slice(0, 2).map(function (p) { return (p[0] || '').toUpperCase(); }).join('') || 'J';
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<rect width="100%" height="100%" rx="' + Math.floor(size / 2) + '" fill="#03180b"/>' +
    '<circle cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + (size / 2 - 2) + '" fill="none" stroke="#22c55e" stroke-width="2"/>' +
    '<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="' + Math.floor(size * 0.32) + '" fill="#22c55e" font-weight="700">' + initials + '</text>' +
    '</svg>';
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

async function api(url, options) {
  const opts = options || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const res = await fetch(url, Object.assign({}, opts, { headers: headers }));
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || 'Erro na requisicao');
  return data;
}

function esc(v) {
  return String(v == null ? '' : v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
