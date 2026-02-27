var duration = 600;
var remaining = duration;
var interval = null;
var scoreA = 0;
var scoreB = 0;
var currentPlayerAction = null;
var teamAPlayers = [];
var teamBPlayers = [];
var playerLiveStats = {};
var matchEvents = [];
var liveGameId = null;
var matchStarted = false;
var matchMeta = { teamAId: '', teamBId: '', teamAName: 'Time A', teamBName: 'Time B', teamALogoDataUrl: '', teamBLogoDataUrl: '' };
var lastSyncAt = 0;

window.addEventListener('DOMContentLoaded', function () {
  var q = new URLSearchParams(window.location.search);
  var teamAId = q.get('teamA') || '';
  var teamBId = q.get('teamB') || '';
  var teamAName = q.get('teamAName') || 'Time A';
  var teamBName = q.get('teamBName') || 'Time B';
  var teamALogo = q.get('teamALogo') || '';
  var teamBLogo = q.get('teamBLogo') || '';

  liveGameId = 'live_' + Date.now();
  matchMeta = { teamAId: teamAId, teamBId: teamBId, teamAName: teamAName, teamBName: teamBName, teamALogoDataUrl: teamALogo, teamBLogoDataUrl: teamBLogo };

  setTeamHeader('teamAName', teamAName, teamALogo);
  setTeamHeader('teamBName', teamBName, teamBLogo);
  setText('goalPlusA', 'Gol + ' + teamAName);
  setText('goalMinusA', 'Gol - ' + teamAName);
  setText('goalPlusB', 'Gol + ' + teamBName);
  setText('goalMinusB', 'Gol - ' + teamBName);

  bindGoalButtons();
  bindPlayerActionModal();
  loadRoster(teamAId, teamBId);
  updateDisplay();
  updateScore();
  renderTimeline();
  registerSw();
});

function bindGoalButtons() {
  var plusA = byId('goalPlusA');
  var minusA = byId('goalMinusA');
  var plusB = byId('goalPlusB');
  var minusB = byId('goalMinusB');
  if (plusA) plusA.addEventListener('click', function () { addGoal('A'); });
  if (minusA) minusA.addEventListener('click', function () { removeGoal('A'); });
  if (plusB) plusB.addEventListener('click', function () { addGoal('B'); });
  if (minusB) minusB.addEventListener('click', function () { removeGoal('B'); });
}

async function loadRoster(teamAId, teamBId) {
  try {
    var data = await api('/api/public/roster');
    var teams = Array.isArray(data.teams) ? data.teams : [];
    var ta = teams.find(function (t) { return String(t.id || '') === String(teamAId || ''); });
    var tb = teams.find(function (t) { return String(t.id || '') === String(teamBId || ''); });
    if (!matchMeta.teamALogoDataUrl && ta && ta.logoDataUrl) matchMeta.teamALogoDataUrl = String(ta.logoDataUrl || '');
    if (!matchMeta.teamBLogoDataUrl && tb && tb.logoDataUrl) matchMeta.teamBLogoDataUrl = String(tb.logoDataUrl || '');
    setTeamHeader('teamAName', matchMeta.teamAName, matchMeta.teamALogoDataUrl);
    setTeamHeader('teamBName', matchMeta.teamBName, matchMeta.teamBLogoDataUrl);
    var players = Array.isArray(data.players) ? data.players : [];
    teamAPlayers = players.filter(function (p) { return String(p.teamId || '') === String(teamAId || ''); });
    teamBPlayers = players.filter(function (p) { return String(p.teamId || '') === String(teamBId || ''); });
    renderPlayers('playersA', teamAPlayers, false, 'A');
    renderPlayers('playersB', teamBPlayers, true, 'B');
  } catch (_err) {
    teamAPlayers = [];
    teamBPlayers = [];
    renderPlayers('playersA', [], false, 'A');
    renderPlayers('playersB', [], true, 'B');
  }
}

function renderPlayers(targetId, players, right, side) {
  var root = byId(targetId);
  if (!root) return;
  if (!players.length) {
    root.innerHTML = '';
    return;
  }

  root.innerHTML = players.slice(0, 8).map(function (p) {
    var stats = ensurePlayerStats(p.id);
    var avatar = p.photoDataUrl
      ? '<img src="' + esc(p.photoDataUrl) + '" alt="' + esc(p.name) + '">' 
      : esc(initials(p.name));
    var statsHtml = renderLiveStatChips(stats);
    var info = '<div class="player-info"><div class="player-name">' + esc(p.name) + '</div>' + statsHtml + '</div>';
    var avatarHtml = '<div class="avatar" data-player-action="' + esc(p.id) + '" data-player-side="' + side + '" data-player-name="' + esc(p.name) + '">' +
      avatar +
      (p.isCaptain ? '<div class="captain-badge">C</div>' : '') +
      (p.isTopScorer ? '<div class="topscorer-badge">⚽</div>' : '') +
      '</div>';

    return '<div class="player-row' + (right ? ' right' : '') + '">' +
      (right ? info + avatarHtml : avatarHtml + info) +
      '</div>';
  }).join('');
}

function renderLiveStatChips(stats) {
  var chips = [];
  if (stats.A > 0) chips.push('<span>A ' + stats.A + '</span>');
  if (stats.GP > 0) chips.push('<span>GP ' + stats.GP + '</span>');
  if (stats.GC > 0) chips.push('<span>GC ' + stats.GC + '</span>');
  if (stats.CA > 0) chips.push('<span>CA ' + stats.CA + '</span>');
  if (stats.CV > 0) chips.push('<span>CV ' + stats.CV + '</span>');
  return '<div class="live-stats">' + chips.join('') + '</div>';
}

function ensurePlayerStats(playerId) {
  if (!playerLiveStats[playerId]) {
    playerLiveStats[playerId] = { A: 0, GP: 0, GC: 0, CA: 0, CV: 0 };
  }
  return playerLiveStats[playerId];
}

function bindPlayerActionModal() {
  var rootA = byId('playersA');
  var rootB = byId('playersB');
  var closeBtn = byId('closePlayerActionBtn');
  var backdrop = byId('playerActionBackdrop');
  var modal = byId('playerActionModal');
  var actionButtons = Array.prototype.slice.call(document.querySelectorAll('[data-action-stat]'));

  function onAvatarClick(e) {
    var target = e.target && e.target.closest ? e.target.closest('[data-player-action]') : null;
    if (!target) return;
    openPlayerActionModal({
      id: target.getAttribute('data-player-action'),
      side: target.getAttribute('data-player-side'),
      name: target.getAttribute('data-player-name') || 'Jogador'
    });
  }

  if (rootA) rootA.addEventListener('click', onAvatarClick);
  if (rootB) rootB.addEventListener('click', onAvatarClick);
  if (closeBtn) closeBtn.addEventListener('click', closePlayerActionModal);
  if (backdrop) backdrop.addEventListener('click', closePlayerActionModal);

  actionButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!currentPlayerAction) return;
      var stat = btn.getAttribute('data-action-stat');
      applyPlayerAction(currentPlayerAction, stat);
    });
  });

  if (modal) {
    document.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape') closePlayerActionModal();
    });
  }
}

function openPlayerActionModal(player) {
  currentPlayerAction = player;
  var modal = byId('playerActionModal');
  var subtitle = byId('playerActionSubtitle');
  if (subtitle) subtitle.textContent = player.name + ' - Time ' + player.side;
  if (modal) {
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closePlayerActionModal() {
  currentPlayerAction = null;
  var modal = byId('playerActionModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }
}

async function applyPlayerAction(player, stat) {
  var stats = ensurePlayerStats(player.id);
  if (typeof stats[stat] === 'undefined') return;
  stats[stat] += 1;

  var event = createMatchEvent(player, stat);
  matchEvents.unshift(event);

  if (stat === 'GP') {
    if (player.side === 'A') addGoal('A'); else addGoal('B');
  }

  renderPlayers('playersA', teamAPlayers, false, 'A');
  renderPlayers('playersB', teamBPlayers, true, 'B');
  renderTimeline();
  closePlayerActionModal();

  try {
    await apiPost('/api/public/player-action', { playerId: player.id, action: stat });
    syncLiveGame('update').catch(function () {});
  } catch (err) {
    console.error('Falha ao sincronizar acao do jogador:', err);
  }
}

function createMatchEvent(player, stat) {
  var elapsed = Math.max(0, Number(duration || 0) - Number(remaining || 0));
  return {
    id: 'evt_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
    type: String(stat || ''),
    side: player.side === 'B' ? 'B' : 'A',
    playerId: String(player.id || ''),
    playerName: String(player.name || 'Jogador'),
    teamName: player.side === 'B' ? matchMeta.teamBName : matchMeta.teamAName,
    elapsed: elapsed,
    minute: Math.max(1, Math.ceil(elapsed / 60)),
    createdAt: Date.now()
  };
}

function renderTimeline() {
  var root = byId('eventTimeline');
  if (!root) return;
  if (!matchEvents.length) {
    root.innerHTML = '<div class="timeline-empty">Nenhum evento registrado.</div>';
    return;
  }

  root.innerHTML = matchEvents.slice(0, 50).map(function (evt) {
    var leftCard = evt.side === 'A' ? timelineCardHtml(evt) : '';
    var rightCard = evt.side === 'B' ? timelineCardHtml(evt) : '';
    return '<div class="timeline-item">' +
      '<div class="timeline-side left">' + leftCard + '</div>' +
      '<div class="timeline-center"><span class="timeline-dot"></span>' + esc(formatEventMinute(evt)) + '</div>' +
      '<div class="timeline-side right">' + rightCard + '</div>' +
      '</div>';
  }).join('');
}

function timelineCardHtml(evt) {
  return '<div class="timeline-card">' +
    '<div class="timeline-event">' + esc(eventLabel(evt.type)) + ' <span class="timeline-tag ' + esc(String(evt.type || '').toLowerCase()) + '">' + esc(evt.type) + '</span></div>' +
    '<div class="timeline-player">' + esc(evt.playerName || 'Jogador') + '</div>' +
    '</div>';
}

function formatEventMinute(evt) {
  var minute = Number(evt && evt.minute || 0);
  if (minute > 0) return String(minute) + "'";
  var elapsed = Number(evt && evt.elapsed || 0);
  var mm = Math.floor(elapsed / 60);
  var ss = elapsed % 60;
  return String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

function eventLabel(type) {
  if (type === 'A') return 'Assistencia';
  if (type === 'GP') return 'Gol pro';
  if (type === 'GC') return 'Gol contra';
  if (type === 'CA') return 'Cartao amarelo';
  if (type === 'CV') return 'Cartao vermelho';
  return 'Evento';
}

function updateDisplay() {
  var minutes = Math.floor(remaining / 60);
  var seconds = remaining % 60;
  var el = byId('timer');
  if (el) el.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

function startTimer() {
  if (interval) return;
  if (!matchStarted) {
    matchStarted = true;
    syncLiveGame('start').catch(function (err) { console.error('Falha ao iniciar jogo ao vivo:', err); });
  }
  interval = setInterval(function () {
    if (remaining > 0) {
      remaining -= 1;
      updateDisplay();
      throttledLiveSync();
    } else {
      clearInterval(interval);
      interval = null;
      syncLiveGame('update').catch(function () {});
      alert('Fim de jogo!');
    }
  }, 1000);
}

function pauseTimer() {
  clearInterval(interval);
  interval = null;
  syncLiveGame('update').catch(function () {});
}

function resetGame() {
  clearInterval(interval);
  interval = null;
  remaining = duration;
  scoreA = 0;
  scoreB = 0;
  playerLiveStats = {};
  matchEvents = [];
  updateDisplay();
  updateScore();
  renderPlayers('playersA', teamAPlayers, false, 'A');
  renderPlayers('playersB', teamBPlayers, true, 'B');
  renderTimeline();
  syncLiveGame('update').catch(function () {});
}

function addGoal(team) {
  if (team === 'A') scoreA += 1; else scoreB += 1;
  updateScore();
  syncLiveGame('update').catch(function () {});
}

function removeGoal(team) {
  if (team === 'A' && scoreA > 0) scoreA -= 1;
  if (team === 'B' && scoreB > 0) scoreB -= 1;
  updateScore();
  syncLiveGame('update').catch(function () {});
}

function updateScore() {
  setText('scoreA', String(scoreA));
  setText('scoreB', String(scoreB));
}

function throttledLiveSync() {
  var now = Date.now();
  if (now - lastSyncAt < 3000) return;
  lastSyncAt = now;
  syncLiveGame('update').catch(function () {});
}

async function syncLiveGame(mode) {
  var payload = {
    id: liveGameId,
    teamAId: matchMeta.teamAId,
    teamBId: matchMeta.teamBId,
    teamAName: matchMeta.teamAName,
    teamBName: matchMeta.teamBName,
    teamALogoDataUrl: matchMeta.teamALogoDataUrl || '',
    teamBLogoDataUrl: matchMeta.teamBLogoDataUrl || '',
    scoreA: scoreA,
    scoreB: scoreB,
    events: matchEvents,
    duration: duration,
    remaining: remaining,
    running: !!interval,
    startedAt: Date.now()
  };
  if (mode === 'start') return apiPost('/api/public/live-game/start', payload);
  if (mode === 'end') return apiPost('/api/public/live-game/end', payload);
  return apiPost('/api/public/live-game/update', payload);
}

function endGame() {
  var confirmed = confirm('Encerrar partida e enviar para jogos recentes?');
  if (!confirmed) return;
  clearInterval(interval);
  interval = null;
  syncLiveGame('end')
    .then(function () {
      alert('Partida encerrada e salva em jogos recentes.');
    })
    .catch(function (err) {
      console.error('Falha ao encerrar partida:', err);
      alert('Erro ao encerrar partida.');
    });
}

function byId(id) { return document.getElementById(id); }
function setText(id, text) { var el = byId(id); if (el) el.textContent = text; }
function setTeamHeader(id, name, logoDataUrl) {
  var el = byId(id);
  if (!el) return;
  var n = esc(name || 'Time');
  if (logoDataUrl) {
    el.innerHTML = '<span class="team-name-label"><span class="team-logo-head"><img src="' + esc(logoDataUrl) + '" alt="' + n + '"></span><span>' + n + '</span></span>';
    return;
  }
  el.textContent = String(name || 'Time');
}

async function api(url) {
  var res = await fetch(url);
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || 'Erro');
  return data;
}

async function apiPost(url, body) {
  var res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || 'Erro');
  return data;
}

function initials(name) {
  return String(name || 'J').split(/\s+/).slice(0, 2).map(function (p) {
    return (p[0] || '').toUpperCase();
  }).join('') || 'J';
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}

window.startTimer = startTimer;
window.pauseTimer = pauseTimer;
window.resetGame = resetGame;
window.endGame = endGame;
