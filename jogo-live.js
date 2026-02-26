var duration = 600;
var remaining = duration;
var interval = null;
var scoreA = 0;
var scoreB = 0;

document.addEventListener('DOMContentLoaded', function () {
  var q = new URLSearchParams(window.location.search);
  var teamAId = q.get('teamA') || '';
  var teamBId = q.get('teamB') || '';
  var teamAName = q.get('teamAName') || 'Time A';
  var teamBName = q.get('teamBName') || 'Time B';

  setText('teamAName', teamAName);
  setText('teamBName', teamBName);
  setText('goalPlusA', '⚽ + ' + teamAName);
  setText('goalMinusA', '➖ ' + teamAName);
  setText('goalPlusB', '⚽ + ' + teamBName);
  setText('goalMinusB', '➖ ' + teamBName);

  bindGoalButtons();
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
    renderPlayers('playersA', players.filter(function (p) { return p.teamId === teamAId; }), false);
    renderPlayers('playersB', players.filter(function (p) { return p.teamId === teamBId; }), true);
  } catch (_err) {
    renderPlayers('playersA', [], false);
    renderPlayers('playersB', [], true);
  }
}

function renderPlayers(targetId, players, right) {
  var root = byId(targetId);
  if (!root) return;
  if (!players.length) {
    root.innerHTML = '';
    return;
  }
  root.innerHTML = players.slice(0, 8).map(function (p) {
    var avatar = p.photoDataUrl
      ? '<img src="' + esc(p.photoDataUrl) + '" alt="' + esc(p.name) + '">'
      : esc(initials(p.name));
    return '<div class="player-row' + (right ? ' right' : '') + '">' +
      (right ? '<div class="player-name">' + esc(p.name) + '</div>' : '') +
      '<div class="avatar">' + avatar + (p.isCaptain ? '<div class="captain-badge">C</div>' : '') + '</div>' +
      (!right ? '<div class="player-name">' + esc(p.name) + '</div>' : '') +
      '</div>';
  }).join('');
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
  interval = setInterval(function (){
    if(remaining > 0){
      remaining--;
      updateDisplay();
    } else {
      clearInterval(interval);
      interval = null;
      alert('Fim de jogo!');
    }
  },1000);
}

function pauseTimer(){
  clearInterval(interval);
  interval = null;
}

function resetGame(){
  clearInterval(interval);
  interval = null;
  remaining = duration;
  scoreA = 0;
  scoreB = 0;
  updateDisplay();
  updateScore();
}

function addGoal(team){
  if(team === 'A') scoreA++;
  else scoreB++;
  updateScore();
}

function removeGoal(team){
  if(team === 'A' && scoreA > 0) scoreA--;
  if(team === 'B' && scoreB > 0) scoreB--;
  updateScore();
}

function updateScore(){
  byId('scoreA').textContent = String(scoreA);
  byId('scoreB').textContent = String(scoreB);
}

function byId(id) { return document.getElementById(id); }
function setText(id, text) { var el = byId(id); if (el) el.textContent = text; }

async function api(url) {
  var res = await fetch(url);
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
