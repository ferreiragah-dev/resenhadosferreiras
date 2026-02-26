var duration = 600;
var remaining = duration;
var interval = null;
var scoreA = 0;
var scoreB = 0;
var currentPlayerAction = null;
var teamAPlayers = [];
var teamBPlayers = [];
var playerLiveStats = {};
var liveGameId = null;
var matchStarted = false;
var matchMeta = { teamAId: '', teamBId: '', teamAName: 'Time A', teamBName: 'Time B' };
var lastSyncAt = 0;

document.addEventListener('DOMContentLoaded', function () {
  var q = new URLSearchParams(window.location.search);
  var teamAId = q.get('teamA') || '';
  var teamBId = q.get('teamB') || '';
  var teamAName = q.get('teamAName') || 'Time A';
  var teamBName = q.get('teamBName') || 'Time B';
  liveGameId = 'live_' + Date.now();
  matchMeta = { teamAId: teamAId, teamBId: teamBId, teamAName: teamAName, teamBName: teamBName };

  setText('teamAName', teamAName);
  setText('teamBName', teamBName);
  setText('goalPlusA', '⚽ + ' + teamAName);
  setText('goalMinusA', '➖ ' + teamAName);
  setText('goalPlusB', '⚽ + ' + teamBName);
  setText('goalMinusB', '➖ ' + teamBName);

  bindGoalButtons();
  bindPlayerActionModal();
  loadRoster(teamAId, teamBId);
  updateDisplay();
  updateScore();
});

function bindGoalButtons() {
  byId('goalPlusA').addEventListener('click', function () { addGoal('A'); });
  byId('goalMinusA').addEventListener('click', function () { removeGoal('A'); });
  byId('goalPlusB').addEventListener('click', function () { addGoal('B'); });
  byId('goalMinusB').addEventListener('click', function () { removeGoal('B'); });
}

async function loadRoster(teamAId, teamBId) {
  try {
    var data = await api('/api/public/roster');
    var players = Array.isArray(data.players) ? data.players : [];
    teamAPlayers = players.filter(function (p) { return p.teamId === teamAId; });
    teamBPlayers = players.filter(function (p) { return p.teamId === teamBId; });
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
    return '<div class="player-row' + (right ? ' right' : '') + '">' +
      (right ? '<div class="player-info"><div class="player-name">' + esc(p.name) + '</div>' + statsHtml + '</div>' : '') +
      '<div class="avatar" data-player-action="' + esc(p.id) + '" data-player-side="' + side + '" data-player-name="' + esc(p.name) + '">' + avatar + (p.isCaptain ? '<div class="captain-badge">C</div>' : '') + '</div>' +
      (!right ? '<div class="player-info"><div class="player-name">' + esc(p.name) + '</div>' + statsHtml + '</div>' : '') +
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
    var target = e.target.closest('[data-player-action]');
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
      if (e.key === 'Escape') closePlayerActionModal();
    });
  }
}

function openPlayerActionModal(player) {
  currentPlayerAction = player;
  var modal = byId('playerActionModal');
  var subtitle = byId('playerActionSubtitle');
  if (subtitle) subtitle.textContent = player.name + ' • Time ' + player.side;
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
  if (!stats[stat] && stats[stat] !== 0) return;
  stats[stat] += 1;

  if (stat === 'GP') {
    addGoal(player.side === 'A' ? 'A' : 'B');
  }

  if (stat === 'GC') {
    // Apenas contabiliza para o jogador, sem alterar placar automaticamente.
  }

  renderPlayers('playersA', teamAPlayers, false, 'A');
  renderPlayers('playersB', teamBPlayers, true, 'B');
  closePlayerActionModal();

  try {
    await apiPost('/api/public/player-action', { playerId: player.id, action: stat });
  } catch (err) {
    console.error('Falha ao sincronizar ação do jogador:', err);
  }
}

function updateDisplay(){
  var minutes = Math.floor(remaining / 60);
  var seconds = remaining % 60;
  byId('timer').textContent =
    String(minutes).padStart(2,'0') + ':' +
    String(seconds).padStart(2,'0');
}

function startTimer(){
  if(interval) return;
  if (!matchStarted) {
    matchStarted = true;
    syncLiveGame('start').catch(function (err) { console.error('Falha ao iniciar jogo ao vivo:', err); });
  }
  interval = setInterval(function (){
    if(remaining > 0){
      remaining--;
      updateDisplay();
      throttledLiveSync();
    } else {
      clearInterval(interval);
      interval = null;
      syncLiveGame('update').catch(function () {});
      alert('Fim de jogo!');
    }
  },1000);
}

function pauseTimer(){
  clearInterval(interval);
  interval = null;
  syncLiveGame('update').catch(function () {});
}

function resetGame(){
  clearInterval(interval);
  interval = null;
  remaining = duration;
  scoreA = 0;
  scoreB = 0;
  updateDisplay();
  updateScore();
  syncLiveGame('update').catch(function () {});
}

function addGoal(team){
  if(team === 'A') scoreA++;
  else scoreB++;
  updateScore();
  syncLiveGame('update').catch(function () {});
}

function removeGoal(team){
  if(team === 'A' && scoreA > 0) scoreA--;
  if(team === 'B' && scoreB > 0) scoreB--;
  updateScore();
  syncLiveGame('update').catch(function () {});
}

function updateScore(){
  byId('scoreA').textContent = String(scoreA);
  byId('scoreB').textContent = String(scoreB);
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
    scoreA: scoreA,
    scoreB: scoreB,
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
  return String(name || 'J').split(/\s+/).slice(0,2).map(function (p) { return (p[0] || '').toUpperCase(); }).join('') || 'J';
}

function esc(v) {
  return String(v == null ? '' : v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

window.startTimer = startTimer;
window.pauseTimer = pauseTimer;
window.resetGame = resetGame;
window.endGame = endGame;
