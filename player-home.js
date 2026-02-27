const TOKEN_KEY = 'resenha-player-token';
const HOME_CACHE_KEY = 'resenha-player-home-cache-v2';
const HOME_CACHE_SESSION_KEY = 'resenha-player-home-cache-session-v2';
var homePoll = null;
var homePollMs = 0;
var currentTab = 'perfil';
var latestHomeData = null;
var loadedSections = { perfil: false, tabela: false, ranking: false, 'ao-vivo': false, temporada: false, jogos: false };
var homeRequestSeq = 0;
var homeAbortController = null;

const els = {
  tabs: Array.prototype.slice.call(document.querySelectorAll('.tab')),
  sideMenu: document.getElementById('sideMenu'),
  sidebarOverlay: document.getElementById('sidebarOverlay'),
  menuOpenBtn: document.getElementById('menuOpenBtn'),
  menuCloseBtn: document.getElementById('menuCloseBtn'),
  enablePushBtn: document.getElementById('enablePushBtn'),
  perfil: document.getElementById('perfil'),
  tabela: document.getElementById('tabela'),
  ranking: document.getElementById('ranking'),
  aoVivo: document.getElementById('ao-vivo'),
  temporada: document.getElementById('temporada'),
  jogos: document.getElementById('jogos'),
  refreshBtn: document.getElementById('refreshBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  pendingBox: document.getElementById('pendingBox'),
  pendingText: document.getElementById('pendingText'),
  mainAvatar: document.getElementById('mainAvatar'),
  mainCaptainBadge: document.getElementById('mainCaptainBadge'),
  mainTopScorerBadge: document.getElementById('mainTopScorerBadge'),
  mainName: document.getElementById('mainName'),
  mainTeam: document.getElementById('mainTeam'),
  mainStats: document.getElementById('mainStats'),
  teammatesList: document.getElementById('teammatesList'),
  standingsTable: document.getElementById('standingsTable'),
  playerRankingList: document.getElementById('playerRankingList'),
  liveGameBox: document.getElementById('liveGameBox'),
  liveTimelineBox: document.getElementById('liveTimelineBox'),
  upcomingGamesBox: document.getElementById('upcomingGamesBox'),
  recentGamesBox: document.getElementById('recentGamesBox'),
  teamLineupDialog: document.getElementById('teamLineupDialog'),
  teamLineupTitle: document.getElementById('teamLineupTitle'),
  teamLineupList: document.getElementById('teamLineupList'),
  closeTeamLineupBtn: document.getElementById('closeTeamLineupBtn')
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
      loadSection(currentTab, true).catch(function (err) {
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

  document.addEventListener('click', function (e) {
    var trigger = e.target && e.target.closest ? e.target.closest('[data-team-open-name]') : null;
    if (!trigger) return;
    e.preventDefault();
    openTeamLineupDialog(trigger.getAttribute('data-team-open-id') || '', trigger.getAttribute('data-team-open-name') || '');
  });

  if (els.closeTeamLineupBtn) {
    els.closeTeamLineupBtn.addEventListener('click', function () {
      if (els.teamLineupDialog && typeof els.teamLineupDialog.close === 'function') els.teamLineupDialog.close();
    });
  }

  if (els.menuOpenBtn) {
    els.menuOpenBtn.addEventListener('click', function () {
      openSideMenu();
    });
  }
  if (els.menuCloseBtn) {
    els.menuCloseBtn.addEventListener('click', function () {
      closeSideMenu();
    });
  }
  if (els.sidebarOverlay) {
    els.sidebarOverlay.addEventListener('click', function () {
      closeSideMenu();
    });
  }

  if (els.enablePushBtn) {
    els.enablePushBtn.addEventListener('click', function () {
      setupPushForCurrentUser(true).catch(function () {});
    });
  }
}

async function bootstrap() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.href = '/player';
    return;
  }

  startHomePolling();

  var cached = readHomeCache();
  if (cached) {
    latestHomeData = cached;
    loadedSections.perfil = true;
    renderProfileSection(cached);
  }

  try {
    await loadSection('perfil', true);
  } catch (err) {
    console.error('Erro no bootstrap da home do jogador:', err);
    if (isAuthError(err)) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/player';
    }
  }

  setupPushForCurrentUser(false).catch(function () {});
}


function startHomePolling() {
  restartHomePollingForCurrentTab();
}

function restartHomePollingForCurrentTab() {
  var nextMs = (currentTab === 'ranking' || currentTab === 'ao-vivo') ? 2000 : 8000;
  if (homePoll && homePollMs === nextMs) return;
  if (homePoll) clearInterval(homePoll);
  homePollMs = nextMs;
  homePoll = setInterval(function () {
    loadSection(currentTab, true).catch(function () {});
  }, nextMs);
}
async function showTab(tab) {
  if (!els.perfil || !els.tabela || !els.ranking || !els.jogos || !els.aoVivo || !els.temporada) return;
  els.perfil.classList.add('hidden');
  els.tabela.classList.add('hidden');
  els.ranking.classList.add('hidden');
  els.aoVivo.classList.add('hidden');
  els.temporada.classList.add('hidden');
  els.jogos.classList.add('hidden');
  els.tabs.forEach(function (t) { t.classList.remove('active'); });
  currentTab = tab || 'perfil';

  if (tab === 'tabela') {
    els.tabela.classList.remove('hidden');
    setActiveTab('tabela');
  } else if (tab === 'ranking') {
    els.ranking.classList.remove('hidden');
    setActiveTab('ranking');
  } else if (tab === 'ao-vivo') {
    els.aoVivo.classList.remove('hidden');
    setActiveTab('ao-vivo');
  } else if (tab === 'temporada') {
    els.temporada.classList.remove('hidden');
    setActiveTab('temporada');
  } else if (tab === 'jogos') {
    els.jogos.classList.remove('hidden');
    setActiveTab('jogos');
  } else {
    currentTab = 'perfil';
    els.perfil.classList.remove('hidden');
    setActiveTab('perfil');
  }
  try {
    await ensureSectionLoaded(currentTab);
  } catch (_err) {}
  closeSideMenu();
  restartHomePollingForCurrentTab();
}

function setActiveTab(tab) {
  els.tabs.forEach(function (t) {
    if (t.getAttribute('data-tab') === tab) t.classList.add('active');
  });
}

function openSideMenu() {
  if (els.sideMenu) {
    els.sideMenu.classList.add('open');
    els.sideMenu.setAttribute('aria-hidden', 'false');
  }
  if (els.sidebarOverlay) els.sidebarOverlay.classList.remove('hidden');
}

function closeSideMenu() {
  if (els.sideMenu) {
    els.sideMenu.classList.remove('open');
    els.sideMenu.setAttribute('aria-hidden', 'true');
  }
  if (els.sidebarOverlay) els.sidebarOverlay.classList.add('hidden');
}

async function ensureSectionLoaded(section) {
  var key = normalizeSection(section);
  if (loadedSections[key]) return;
  setSectionLoading(key);
  await loadSection(key, false);
}

function normalizeSection(section) {
  var s = String(section || 'perfil').toLowerCase();
  if (s !== 'perfil' && s !== 'tabela' && s !== 'ranking' && s !== 'ao-vivo' && s !== 'temporada' && s !== 'jogos') return 'perfil';
  return s;
}

function setSectionLoading(tab) {
  if (tab === 'tabela' && els.standingsTable && !els.standingsTable.innerHTML.trim()) {
    els.standingsTable.innerHTML = '<div class="empty-state">Carregando tabela...</div>';
    return;
  }
  if (tab === 'ranking' && els.playerRankingList && !els.playerRankingList.innerHTML.trim()) {
    els.playerRankingList.innerHTML = '<div class="empty-state">Carregando ranking...</div>';
    return;
  }
  if (tab === 'ao-vivo') {
    if (els.liveGameBox && !els.liveGameBox.innerHTML.trim()) els.liveGameBox.innerHTML = '<div class="empty-state">Carregando jogo ao vivo...</div>';
    if (els.liveTimelineBox && !els.liveTimelineBox.innerHTML.trim()) els.liveTimelineBox.innerHTML = '<div class="empty-state">Carregando timeline...</div>';
    return;
  }
  if (tab === 'temporada' && els.upcomingGamesBox && !els.upcomingGamesBox.innerHTML.trim()) {
    els.upcomingGamesBox.innerHTML = '<div class="empty-state">Carregando temporada...</div>';
    return;
  }
  if (tab === 'jogos' && els.recentGamesBox && !els.recentGamesBox.innerHTML.trim()) {
    els.recentGamesBox.innerHTML = '<div class="empty-state">Carregando jogos...</div>';
  }
}

async function loadSection(section, force) {
  var key = normalizeSection(section);
  const token = localStorage.getItem(TOKEN_KEY);
  const reqSeq = ++homeRequestSeq;
  if (homeAbortController) {
    try { homeAbortController.abort(); } catch (_err) {}
  }
  homeAbortController = typeof AbortController === 'function' ? new AbortController() : null;
  const data = await api('/api/player/home?section=' + encodeURIComponent(key), {
    headers: { Authorization: 'Bearer ' + token },
    signal: homeAbortController ? homeAbortController.signal : undefined,
    timeoutMs: 4500
  });
  if (reqSeq !== homeRequestSeq) return;
  var next = data && typeof data === 'object' ? data : null;
  if (!next) return;

  // Evita "flash" de estado pendente quando ja existe estado vinculado valido.
  if (!next.linked && latestHomeData && latestHomeData.linked) {
    return;
  }

  latestHomeData = Object.assign({}, latestHomeData || {}, next);
  if (key === 'perfil') {
    writeHomeCache(latestHomeData);
    loadedSections.perfil = true;
    renderProfileSection(latestHomeData);
    return;
  }

  loadedSections[key] = true;
  renderSectionByTab(key, latestHomeData);
}

function isAuthError(err) {
  var msg = String(err && err.message || '').toLowerCase();
  return msg.indexOf('nao autenticado') >= 0 || msg.indexOf('token invalido') >= 0 || msg.indexOf('unauthorized') >= 0 || msg.indexOf('forbidden') >= 0;
}

function renderProfileSection(data) {
  if (!data || typeof data !== 'object') return;
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
      isCaptain: false,
      isTopScorer: false
    });
    renderTeammates([]);
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
    isCaptain: !!(data.player && data.player.isCaptain),
    isTopScorer: !!(data.player && data.player.isTopScorer)
  });

  renderTeammates(Array.isArray(data.teammates) ? data.teammates : []);
}

function renderSectionByTab(tab, data) {
  if (!data || typeof data !== 'object') return;
  if (!data.linked) return;
  if (tab === 'tabela') {
    renderStandings(Array.isArray(data.standings) ? data.standings : []);
    return;
  }
  if (tab === 'ranking') {
    renderPlayerRanking(Array.isArray(data.playerRanking) ? data.playerRanking : []);
    return;
  }
  if (tab === 'ao-vivo') {
    renderLiveGame(data.liveGame || null);
    renderLiveTimeline(data.liveGame && Array.isArray(data.liveGame.events) ? data.liveGame.events : []);
    return;
  }
  if (tab === 'temporada') {
    renderUpcomingGames(Array.isArray(data.gameSchedule) ? data.gameSchedule : []);
    return;
  }
  if (tab === 'jogos') {
    renderRecentGames(Array.isArray(data.recentGames) ? data.recentGames : []);
  }
}

function writeHomeCache(data) {
  try {
    if (!data || typeof data !== 'object') return;
    if (!data.linked) return;
    var compact = compactHomeDataForCache(data);
    var raw = JSON.stringify(compact);
    sessionStorage.setItem(HOME_CACHE_SESSION_KEY, raw);
    localStorage.setItem(HOME_CACHE_KEY, raw);
  } catch (_err) {}
}

function readHomeCache() {
  var raw = '';
  try {
    raw = sessionStorage.getItem(HOME_CACHE_SESSION_KEY) || localStorage.getItem(HOME_CACHE_KEY) || '';
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.linked) return null;
    return parsed;
  } catch (_err) {
    return null;
  }
}

function compactHomeDataForCache(data) {
  var d = data || {};
  return {
    linked: true,
    user: d.user || null,
    settings: d.settings || null,
    player: d.player || null,
    team: d.team || null,
    teamStats: d.teamStats || null,
    teammates: Array.isArray(d.teammates) ? d.teammates.slice(0, 30).map(function (p) {
      return {
        id: p.id,
        name: p.name,
        yellowCards: p.yellowCards || 0,
        redCards: p.redCards || 0,
        goals: p.goals || 0,
        assists: p.assists || 0,
        goalsPro: p.goalsPro || 0,
        goalsContra: p.goalsContra || 0,
        isCaptain: Boolean(p.isCaptain),
        isTopScorer: Boolean(p.isTopScorer),
        photoDataUrl: p.photoDataUrl || '',
        isMe: Boolean(p.isMe)
      };
    }) : [],
    standings: Array.isArray(d.standings) ? d.standings.slice(0, 30) : [],
    playerRanking: Array.isArray(d.playerRanking) ? d.playerRanking.slice(0, 120).map(function (p) {
      return {
        id: p.id,
        name: p.name,
        teamName: p.teamName,
        goals: p.goals || 0,
        assists: p.assists || 0,
        yellowCards: p.yellowCards || 0,
        redCards: p.redCards || 0,
        rankingPoints: p.rankingPoints || 0,
        isCaptain: Boolean(p.isCaptain),
        isTopScorer: Boolean(p.isTopScorer)
      };
    }) : [],
    gameSchedule: Array.isArray(d.gameSchedule) ? d.gameSchedule.slice(0, 80) : [],
    liveGame: d.liveGame || null,
    recentGames: Array.isArray(d.recentGames) ? d.recentGames.slice(0, 20) : []
  };
}

function renderProfile(profile) {
  if (els.mainAvatar) els.mainAvatar.src = profile.photoDataUrl || avatarFallback(profile.name, 96);
  if (els.mainCaptainBadge) {
    if (profile.isCaptain) els.mainCaptainBadge.classList.remove('hidden');
    else els.mainCaptainBadge.classList.add('hidden');
  }
  if (els.mainTopScorerBadge) {
    if (profile.isTopScorer) els.mainTopScorerBadge.classList.remove('hidden');
    else els.mainTopScorerBadge.classList.add('hidden');
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
      (m.isTopScorer ? '<span class="topscorer-badge small left">⚽</span>' : '') +
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

  els.standingsTable.innerHTML =
    '<div class="table-container-neon">' +
      '<table class="standings-neon">' +
        '<thead><tr>' +
          '<th>#</th><th>Time</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th>' +
        '</tr></thead>' +
        '<tbody>' +
          list.map(function (t, idx) {
            var sg = Number(t.goalDiff || 0);
            return '<tr class="' + (idx === 0 ? 'leader' : '') + '">' +
              '<td class="rank">' + (idx + 1) + '</td>' +
              '<td class="team-cell-neon">' + teamCellHtml(t.name || 'Time', t.logoDataUrl || '') + '</td>' +
              '<td>' + Number(t.points || 0) + '</td>' +
              '<td>' + Number(t.games || 0) + '</td>' +
              '<td>' + Number(t.wins || 0) + '</td>' +
              '<td>' + Number(t.draws || 0) + '</td>' +
              '<td>' + Number(t.losses || 0) + '</td>' +
              '<td>' + Number(t.goalsPro || 0) + '</td>' +
              '<td>' + Number(t.goalsContra || 0) + '</td>' +
              '<td>' + (sg > 0 ? '+' + sg : String(sg)) + '</td>' +
            '</tr>';
          }).join('') +
        '</tbody>' +
      '</table>' +
    '</div>';
}

function teamCellHtml(name, logoDataUrl) {
  var n = esc(name || 'Time');
  if (logoDataUrl) return '<span class="team-cell-wrap"><span class="team-logo-cell"><img src="' + esc(logoDataUrl) + '" alt="' + n + '"></span><span>' + n + '</span></span>';
  return '<span class="team-cell-wrap"><span>' + n + '</span></span>';
}

function renderPlayerRanking(list) {
  if (!els.playerRankingList) return;
  if (!list || !list.length) {
    els.playerRankingList.innerHTML = '<div class="empty-state">Nenhum jogador para ranking.</div>';
    return;
  }

  els.playerRankingList.innerHTML = list.map(function (p, idx) {
    var photo = p.photoDataUrl || avatarFallback(p.name, 34);
    var pts = safeNum(p.rankingPoints);
    var goals = safeNum(p.goals);
    var assists = safeNum(p.assists);
    var yellowCards = safeNum(p.yellowCards);
    var redCards = safeNum(p.redCards);
    return '<div class="player-item">' +
      '<div class="player-left">' +
      '<div class="rank-badge">' + (idx + 1) + '</div>' +
      '<div class="player-avatar-wrap">' +
      '<img class="player-avatar" src="' + esc(photo) + '" alt="' + esc(p.name) + '">' +
      (p.isCaptain ? '<span class="captain-badge small">C</span>' : '') +
      (p.isTopScorer ? '<span class="topscorer-badge small left">⚽</span>' : '') +
      '</div>' +
      '<div>' +
      '<div class="player-name">' + esc(p.name) + '</div>' +
      '<div class="rank-team">' + esc(p.teamName || 'Sem time') + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="player-stats">' +
      '<span>Pts ' + pts + '</span>' +
      '<span>G ' + goals + '</span>' +
      '<span>A ' + assists + '</span>' +
      '<span>CA ' + yellowCards + '</span>' +
      '<span>CV ' + redCards + '</span>' +
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
  els.liveGameBox.innerHTML = '<div class="match-card-neon">' +
    '<div class="match-header-neon"><div>⏱ ' + timer + '</div><div>' + (game.running ? 'Ao vivo' : 'Pausado') + '</div></div>' +
    '<div class="match-body-neon">' +
      teamNeonBlock(game.teamAName || 'Time A', game.teamALogoDataUrl || '', game.teamAId || '') +
      '<div class="score-center-neon"><div class="score-neon">' + Number(game.scoreA || 0) + ' x ' + Number(game.scoreB || 0) + '</div><div class="vs-neon">' + (game.running ? 'AO VIVO' : 'PAUSADO') + '</div></div>' +
      teamNeonBlock(game.teamBName || 'Time B', game.teamBLogoDataUrl || '', game.teamBId || '') +
    '</div>' +
    '<div class="match-footer-neon">Partida em andamento</div>' +
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
    return '<div class="match-card-neon recent-game-card">' +
      '<div class="match-header-neon"><div>⏱ ' + dateLabel + '</div><div>Encerrado</div></div>' +
      '<div class="match-body-neon">' +
        teamNeonBlock(g.teamAName || 'Time A', g.teamALogoDataUrl || '', g.teamAId || '') +
        '<div class="score-center-neon"><div class="score-neon">' + Number(g.scoreA || 0) + ' x ' + Number(g.scoreB || 0) + '</div><div class="vs-neon">FINAL</div></div>' +
        teamNeonBlock(g.teamBName || 'Time B', g.teamBLogoDataUrl || '', g.teamBId || '') +
      '</div>' +
      '<div class="match-footer-neon">Duração: ' + formatSeconds(Number(g.duration || 600)) + '</div>' +
      '</div>';
  }).join('');
}

function renderUpcomingGames(list) {
  if (!els.upcomingGamesBox) return;
  if (!list || !list.length) {
    els.upcomingGamesBox.innerHTML = '<div class="empty-state">Nenhum jogo agendado.</div>';
    return;
  }

  var phasePriority = {
    'FASE DE GRUPO (2x7 minutos)': 1,
    'SEMIFINAIS (2x7 minutos)': 2,
    'FINAL (2x7 minutos)': 3
  };

  var rows = list.slice().sort(function (a, b) {
    var phaseA = String(a.phase || '');
    var phaseB = String(b.phase || '');
    var orderA = Object.prototype.hasOwnProperty.call(phasePriority, phaseA) ? phasePriority[phaseA] : 99;
    var orderB = Object.prototype.hasOwnProperty.call(phasePriority, phaseB) ? phasePriority[phaseB] : 99;
    var phaseCmp = orderA - orderB || phaseA.localeCompare(phaseB, 'pt-BR');
    if (phaseCmp) return phaseCmp;
    return String(a.time || '').localeCompare(String(b.time || ''));
  });

  els.upcomingGamesBox.innerHTML = rows.map(function (g) {
    var phase = String(g.phase || 'Fase');
    var groupLabel = String(g.groupLabel || '').trim();
    return '<div class="match-card-neon">' +
      '<div class="match-header-neon"><div>⏱ ' + esc(g.time || '--:--') + '</div><div>' + esc(groupLabel || 'Agenda') + '</div></div>' +
      '<div class="match-body-neon">' +
        teamNeonBlock(g.teamALabel || 'Time A', g.teamALogoDataUrl || '', g.teamAId || '') +
        '<div class="score-center-neon"><div class="score-neon">-- x --</div><div class="vs-neon">AGENDADO</div></div>' +
        teamNeonBlock(g.teamBLabel || 'Time B', g.teamBLogoDataUrl || '', g.teamBId || '') +
      '</div>' +
      '<div class="match-footer-neon">' + esc(phase) + ' • Temporada Verão 2026</div>' +
      '</div>';
  }).join('');
}

function teamNeonBlock(name, logoDataUrl, teamId) {
  return '<button type="button" class="team-neon team-neon-btn" data-team-open-id="' + esc(teamId || '') + '" data-team-open-name="' + esc(name || 'Time') + '">' +
    teamLogoOnlyHtml(name || 'Time', logoDataUrl || '') +
    '<div class="team-name-neon">' + esc(name || 'Time') + '</div>' +
    '</button>';
}

function teamLogoOnlyHtml(name, logoDataUrl) {
  var n = String(name || 'Time');
  if (logoDataUrl) return '<span class="team-logo-neon"><img src="' + esc(logoDataUrl) + '" alt="' + esc(n) + '"></span>';
  return '<span class="team-logo-neon team-logo-fallback">' + esc((n.split(/\s+/).slice(0, 2).map(function (p) { return (p[0] || '').toUpperCase(); }).join('')) || 'T') + '</span>';
}

function teamLabelHtml(name, logoDataUrl, sizeClass, labelClass) {
  var n = esc(name || 'Time');
  var cls = sizeClass ? ' team-logo-' + esc(sizeClass) : '';
  var labelCls = labelClass ? ' team-label-' + esc(labelClass) : '';
  if (logoDataUrl) return '<span class="team-label' + labelCls + '"><span class="team-logo' + cls + '"><img src="' + esc(logoDataUrl) + '" alt="' + n + '"></span><span class="team-name-mini">' + n + '</span></span>';
  return '<span class="team-label' + labelCls + '"><span class="team-name-mini">' + n + '</span></span>';
}

function openTeamLineupDialog(teamId, teamName) {
  if (!els.teamLineupDialog || !els.teamLineupList || !els.teamLineupTitle) return;
  var name = String(teamName || 'Time').trim() || 'Time';
  var normalized = name.toLowerCase();
  var ranking = Array.isArray(latestHomeData && latestHomeData.playerRanking) ? latestHomeData.playerRanking : [];
  var players = ranking.filter(function (p) {
    return String(p && p.teamName || '').trim().toLowerCase() === normalized;
  });

  if (!players.length) {
    var teammates = Array.isArray(latestHomeData && latestHomeData.teammates) ? latestHomeData.teammates : [];
    var myTeam = String((latestHomeData && latestHomeData.team && latestHomeData.team.name) || '').trim().toLowerCase();
    if (myTeam && myTeam === normalized) players = teammates;
  }

  els.teamLineupTitle.textContent = 'Escalacao - ' + name;
  if (!players.length) {
    els.teamLineupList.innerHTML = '<div class="empty-state">Nenhum jogador encontrado para esse time.</div>';
    els.teamLineupDialog.showModal();
    return;
  }

  els.teamLineupList.innerHTML = players.map(function (p) {
    var avatar = p.photoDataUrl
      ? '<span class="team-lineup-avatar"><img src="' + esc(p.photoDataUrl) + '" alt="' + esc(p.name || 'Jogador') + '"></span>'
      : '<span class="team-lineup-avatar">' + esc(initials(p.name || 'J')) + '</span>';
    return '<div class="team-lineup-item">' +
      '<div class="team-lineup-left">' +
      avatar +
      '<div class="team-lineup-name">' + esc(p.name || 'Jogador') + '</div>' +
      '</div>' +
      '<div class="team-lineup-stats">' +
      (p.isCaptain ? '<span>C</span>' : '') +
      '<span>G ' + safeNum(p.goals) + '</span>' +
      '<span>A ' + safeNum(p.assists) + '</span>' +
      '<span>CA ' + safeNum(p.yellowCards) + '</span>' +
      '<span>CV ' + safeNum(p.redCards) + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
  els.teamLineupDialog.showModal();
}

function initials(name) {
  return String(name || 'J').split(/\s+/).slice(0, 2).map(function (p) { return (p[0] || '').toUpperCase(); }).join('') || 'J';
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

function safeNum(v) {
  var n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var timeoutMs = Number(opts.timeoutMs || 0);
  var timeoutId = null;
  if (!opts.signal && controller && timeoutMs > 0) {
    timeoutId = setTimeout(function () { controller.abort(); }, timeoutMs);
  }
  const res = await fetch(url, Object.assign({}, opts, {
    headers: headers,
    cache: 'no-store',
    credentials: 'same-origin',
    signal: opts.signal || (controller ? controller.signal : undefined)
  }));
  if (timeoutId) clearTimeout(timeoutId);
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || 'Erro na requisicao');
  return data;
}

async function setupPushForCurrentUser(interactive) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    updatePushButtonState('Nao suportado');
    return;
  }
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;

  const keyData = await api('/api/push/public-key', {
    headers: { Authorization: 'Bearer ' + token },
    timeoutMs: 3000
  }).catch(function () { return { enabled: false }; });

  if (!keyData || !keyData.enabled || !keyData.publicKey) {
    updatePushButtonState('Push indisponivel');
    return;
  }

  if (Notification.permission === 'default' && interactive) {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      updatePushButtonState('Permissao negada');
      return;
    }
  }

  if (Notification.permission !== 'granted') {
    updatePushButtonState('Ativar notificacoes');
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(String(keyData.publicKey || ''))
    });
  }

  await api('/api/push/subscribe', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: JSON.stringify({ subscription: subscription })
  });
  updatePushButtonState('Notificacoes ativas');
}

function updatePushButtonState(label) {
  if (!els.enablePushBtn) return;
  els.enablePushBtn.textContent = label;
}

function base64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  var normalized = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var raw = atob(normalized);
  var output = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


