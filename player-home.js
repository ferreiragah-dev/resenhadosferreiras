const TOKEN_KEY = 'resenha-player-token';
var homePoll = null;

const els = {
  tabs: Array.prototype.slice.call(document.querySelectorAll('.tab')),
  perfil: document.getElementById('perfil'),
  tabela: document.getElementById('tabela'),
  aoVivo: document.getElementById('ao-vivo'),
  jogos: document.getElementById('jogos'),
  refreshBtn: document.getElementById('refreshBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  pendingBox: document.getElementById('pendingBox'),
  pendingText: document.getElementById('pendingText'),
  mainAvatar: document.getElementById('mainAvatar'),
  mainCaptainBadge: document.getElementById('mainCaptainBadge'),
  mainName: document.getElementById('mainName'),
  mainTeam: document.getElementById('mainTeam'),
  mainStats: document.getElementById('mainStats'),
  teammatesList: document.getElementById('teammatesList'),
  standingsTable: document.getElementById('standingsTable'),
  liveGameBox: document.getElementById('liveGameBox'),
  liveTimelineBox: document.getElementById('liveTimelineBox'),
  upcomingGamesBox: document.getElementById('upcomingGamesBox'),
  recentGamesBox: document.getElementById('recentGamesBox')
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
    startHomePolling();
  } catch (err) {
    console.error('Erro no bootstrap da home do jogador:', err);
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/player';
  }
}


function startHomePolling() {
  if (homePoll) clearInterval(homePoll);
  homePoll = setInterval(function () {
    loadHome().catch(function () {});
  }, 8000);
}
function showTab(tab) {
  if (!els.perfil || !els.tabela || !els.jogos || !els.aoVivo) return;
  els.perfil.classList.add('hidden');
  els.tabela.classList.add('hidden');
  els.aoVivo.classList.add('hidden');
  els.jogos.classList.add('hidden');
  els.tabs.forEach(function (t) { t.classList.remove('active'); });

  if (tab === 'tabela') {
    els.tabela.classList.remove('hidden');
    setActiveTab('tabela');
  } else if (tab === 'ao-vivo') {
    els.aoVivo.classList.remove('hidden');
    setActiveTab('ao-vivo');
  } else if (tab === 'jogos') {
    els.jogos.classList.remove('hidden');
    setActiveTab('jogos');
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
      redCards: 0,
      isCaptain: false
    });
    renderTeammates([]);
    renderStandings([]);
    renderLiveAndRecentGames(null, [], []);
    return;
  }

  if (els.pendingBox) els.pendingBox.classList.add('hidden');

  renderProfile({
    name: (data.player && data.player.name) || (data.user && data.user.name) || 'Jogador',
    teamName: (data.team && data.team.name) || 'Sem time',
    photoDataUrl: (data.player && data.player.photoDataUrl) || '',
    assists: (data.player && data.player.assists) || 0,
    teamGoalsFor: (data.player && typeof data.player.goalsPro !== 'undefined') ? Number(data.player.goalsPro || 0) : ((data.teamStats && data.teamStats.goalsFor) || 0),
    teamGoalsAgainst: (data.player && typeof data.player.goalsContra !== 'undefined') ? Number(data.player.goalsContra || 0) : ((data.teamStats && data.teamStats.goalsAgainst) || 0),
    yellowCards: (data.player && data.player.yellowCards) || 0,
    redCards: (data.player && data.player.redCards) || 0,
    isCaptain: !!(data.player && data.player.isCaptain)
  });

  renderTeammates(Array.isArray(data.teammates) ? data.teammates : []);
  renderStandings(Array.isArray(data.standings) ? data.standings : []);
  renderLiveAndRecentGames(
    data.liveGame || null,
    Array.isArray(data.recentGames) ? data.recentGames : [],
    Array.isArray(data.gameSchedule) ? data.gameSchedule : []
  );
}

function renderProfile(profile) {
  if (els.mainAvatar) els.mainAvatar.src = profile.photoDataUrl || avatarFallback(profile.name, 96);
  if (els.mainCaptainBadge) {
    if (profile.isCaptain) els.mainCaptainBadge.classList.remove('hidden');
    else els.mainCaptainBadge.classList.add('hidden');
  }
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
      '<div class="player-avatar-wrap">' +
      '<img class="player-avatar" src="' + esc(photo) + '" alt="' + esc(m.name) + '">' +
      (m.isCaptain ? '<span class="captain-badge small">C</span>' : '') +
      '</div>' +
      '<div class="player-name">' + esc(m.name) + (m.isMe ? ' (voce)' : '') + '</div>' +
      '</div>' +
      '<div class="player-stats">' +
      '<span>GP ' + Number(typeof m.goalsPro !== 'undefined' ? (m.goalsPro || 0) : (m.goals || 0)) + '</span><span>A ' + Number(m.assists || 0) + '</span><span>CA ' + Number(m.yellowCards || 0) + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
}

function renderStandings(list) {
  if (!els.standingsTable) return;
  if (!list.length) {
    els.standingsTable.innerHTML = '<div class="empty-state">Nenhuma tabela cadastrada.</div>';
    return;
  }

  els.standingsTable.innerHTML = list.map(function (t, idx) {
    return '<div class="match">' +
      '<div class="match-header"><span>#' + (idx + 1) + '</span><span>' + esc(t.name || 'Time') + '</span></div>' +
      '<div class="match-stats">' +
      '<span>P ' + Number(t.points || 0) + '</span>' +
      '<span>J ' + Number(t.games || 0) + '</span>' +
      '<span>V ' + Number(t.wins || 0) + '</span>' +
      '<span>E ' + Number(t.draws || 0) + '</span>' +
      '<span>D ' + Number(t.losses || 0) + '</span>' +
      '<span>GP ' + Number(t.goalsPro || 0) + '</span>' +
      '<span>GC ' + Number(t.goalsContra || 0) + '</span>' +
      '<span>SG ' + Number(t.goalDiff || 0) + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
}

function renderLiveAndRecentGames(liveGame, recentGames, gameSchedule) {
  renderLiveGame(liveGame);
  renderLiveTimeline(liveGame && Array.isArray(liveGame.events) ? liveGame.events : []);
  renderUpcomingGames(gameSchedule);
  renderRecentGames(recentGames);
}

function renderLiveGame(game) {
  if (!els.liveGameBox) return;
  if (!game) {
    els.liveGameBox.innerHTML = '<div class="empty-state">Nenhum jogo ao vivo no momento.</div>';
    return;
  }
  var timer = formatSeconds(Number(game.remaining || 0));
  els.liveGameBox.innerHTML = '<div class="live-game-card">' +
    '<div class="live-game-title">Partida ao vivo</div>' +
    '<div class="live-game-score">' + esc(game.teamAName || 'Time A') + ' ' + Number(game.scoreA || 0) + ' x ' + Number(game.scoreB || 0) + ' ' + esc(game.teamBName || 'Time B') + '</div>' +
    '<div class="match-stats"><span>⏱ ' + timer + '</span><span>' + (game.running ? 'Ao vivo' : 'Pausado') + '</span></div>' +
    '</div>';
}

function renderLiveTimeline(events) {
  if (!els.liveTimelineBox) return;
  if (!events || !events.length) {
    els.liveTimelineBox.innerHTML = '<div class="timeline-box"><div class="empty-state">Nenhum evento do jogo ao vivo.</div></div>';
    return;
  }

  els.liveTimelineBox.innerHTML = '<div class="timeline-box"><div class="timeline-list">' +
    events.slice(0, 40).map(function (evt) {
      var side = String(evt.side || '');
      var leftCard = side === 'A' ? timelineCard(evt) : '';
      var rightCard = side === 'B' ? timelineCard(evt) : '';
      return '<div class="timeline-item">' +
        '<div class="timeline-side left">' + leftCard + '</div>' +
        '<div class="timeline-center"><span class="timeline-dot"></span>' + esc(formatEventMinute(evt)) + '</div>' +
        '<div class="timeline-side right">' + rightCard + '</div>' +
        '</div>';
    }).join('') +
    '</div></div>';
}

function renderRecentGames(list) {
  if (!els.recentGamesBox) return;
  if (!list || !list.length) {
    els.recentGamesBox.innerHTML = '<div class="empty-state">Nenhum jogo recente.</div>';
    return;
  }
  els.recentGamesBox.innerHTML = list.slice(0, 10).map(function (g) {
    var dateLabel = g.endedAt ? new Date(Number(g.endedAt)).toLocaleString('pt-BR') : 'Finalizado';
    return '<div class="match">' +
      '<div class="match-header"><span>' + dateLabel + '</span><span>Partida</span></div>' +
      '<div class="score">' + esc(g.teamAName || 'Time A') + ' ' + Number(g.scoreA || 0) + ' x ' + Number(g.scoreB || 0) + ' ' + esc(g.teamBName || 'Time B') + '</div>' +
      '<div class="match-stats"><span>Duração: ' + formatSeconds(Number(g.duration || 600)) + '</span></div>' +
      '</div>';
  }).join('');
}

function renderUpcomingGames(list) {
  if (!els.upcomingGamesBox) return;
  if (!list || !list.length) {
    els.upcomingGamesBox.innerHTML = '<div class="empty-state">Nenhum jogo agendado.</div>';
    return;
  }

  var rows = list.slice().sort(function (a, b) {
    var phaseCmp = String(a.phase || '').localeCompare(String(b.phase || ''), 'pt-BR');
    if (phaseCmp) return phaseCmp;
    return String(a.time || '').localeCompare(String(b.time || ''));
  });

  var lastPhase = '';
  els.upcomingGamesBox.innerHTML = rows.map(function (g) {
    var phase = String(g.phase || 'Fase');
    var showPhase = phase !== lastPhase;
    lastPhase = phase;
    var groupLabel = String(g.groupLabel || '').trim();
    return (showPhase ? '<div class="schedule-phase-player">' + esc(phase) + '</div>' : '') +
      '<div class="match">' +
      '<div class="match-header"><span>' + esc(g.time || '--:--') + '</span><span>' + esc(groupLabel || 'Agenda') + '</span></div>' +
      '<div class="score">' + esc(g.teamALabel || 'Time A') + ' x ' + esc(g.teamBLabel || 'Time B') + '</div>' +
      '</div>';
  }).join('');
}

function timelineCard(evt) {
  return '<div class="timeline-card">' +
    '<div class="timeline-event">' + esc(eventLabel(evt.type)) + ' <span class="timeline-tag ' + esc(String(evt.type || '').toLowerCase()) + '">' + esc(evt.type || '') + '</span></div>' +
    '<div class="timeline-player">' + esc(evt.playerName || 'Jogador') + '</div>' +
    '</div>';
}

function formatEventMinute(evt) {
  var minute = Number(evt && evt.minute || 0);
  if (minute > 0) return String(minute) + "'";
  var elapsed = Number(evt && evt.elapsed || 0);
  var m = Math.floor(elapsed / 60);
  var s = elapsed % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function eventLabel(type) {
  if (type === 'A') return 'Assistencia';
  if (type === 'GP') return 'Gol pro';
  if (type === 'GC') return 'Gol contra';
  if (type === 'CA') return 'Cartao amarelo';
  if (type === 'CV') return 'Cartao vermelho';
  return 'Evento';
}

function formatSeconds(total) {
  var sec = Math.max(0, Number(total || 0));
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function statBox(value, label) {
  return '<div class="stat"><div class="value">' + (Number(value) || 0) + '</div><div class="label">' + label + '</div></div>';
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

