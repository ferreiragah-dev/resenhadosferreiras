const STORAGE_KEY = "resenha-ferreira-campeonato-v1";
const ADMIN_SESSION_KEY = "resenha-ferreira-admin-auth";
const ADMIN_FIXED_USER = "admin";
const ADMIN_FIXED_PASSWORD = "ferreiras123@";
const state = loadState();
let selectedPenaltyPlayerId = null;
let pendingGoalEvents = [];
let registeredUsers = [];
let syncTimer = null;
let remotePollTimer = null;

const els = {
  tabs: [...document.querySelectorAll('.tab')],
  panels: [...document.querySelectorAll('.tab-panel')],
  adminLoginGate: document.getElementById('adminLoginGate'),
  adminLoginForm: document.getElementById('adminLoginForm'),
  adminUsername: document.getElementById('adminUsername'),
  adminPassword: document.getElementById('adminPassword'),
  adminLoginError: document.getElementById('adminLoginError'),
  playerForm: document.getElementById('playerForm'),
  playerName: document.getElementById('playerName'),
  playerNumber: document.getElementById('playerNumber'),
  playerPosition: document.getElementById('playerPosition'),
  playerTeamId: document.getElementById('playerTeamId'),
  playerUserId: document.getElementById('playerUserId'),
  playerPhoto: document.getElementById('playerPhoto'),
  playerSearch: document.getElementById('playerSearch'),
  playersList: document.getElementById('playersList'),
  teamForm: document.getElementById('teamForm'),
  teamName: document.getElementById('teamName'),
  teamColor: document.getElementById('teamColor'),
  teamsList: document.getElementById('teamsList'),
  matchForm: document.getElementById('matchForm'),
  matchTeamA: document.getElementById('matchTeamA'),
  matchTeamB: document.getElementById('matchTeamB'),
  matchGoalsA: document.getElementById('matchGoalsA'),
  matchGoalsB: document.getElementById('matchGoalsB'),
  matchStage: document.getElementById('matchStage'),
  matchDate: document.getElementById('matchDate'),
  eventSettingsForm: document.getElementById('eventSettingsForm'),
  eventStartAt: document.getElementById('eventStartAt'),
  eventSettingsMessage: document.getElementById('eventSettingsMessage'),
  matchesList: document.getElementById('matchesList'),
  goalPlayerSelect: document.getElementById('goalPlayerSelect'),
  addGoalBtn: document.getElementById('addGoalBtn'),
  goalEvents: document.getElementById('goalEvents'),
  bracketBoard: document.getElementById('bracketBoard'),
  generateBracketBtn: document.getElementById('generateBracketBtn'),
  playerRanking: document.getElementById('playerRanking'),
  teamRanking: document.getElementById('teamRanking'),
  penaltyDialog: document.getElementById('penaltyDialog'),
  penaltyDialogTitle: document.getElementById('penaltyDialogTitle'),
  resetDataBtn: document.getElementById('resetDataBtn')
};

bindEvents();
renderGoalEvents();
renderAll();
registerServiceWorker();
bootstrapRemote();
bootstrapAdminGate();
startRemotePolling();

function defaultState() {
  return { teams: [], players: [], matches: [], bracket: [], settings: { eventStartAt: '' } };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      teams: Array.isArray(parsed.teams) ? parsed.teams : [],
      players: Array.isArray(parsed.players) ? parsed.players : [],
      matches: Array.isArray(parsed.matches) ? parsed.matches : [],
      bracket: Array.isArray(parsed.bracket) ? parsed.bracket : [],
      settings: { eventStartAt: String(parsed?.settings?.eventStartAt || '') }
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function persistAndRender() {
  saveState();
  renderAll();
  queueServerSync();
}

function bindEvents() {
  els.adminLoginForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const user = String(els.adminUsername?.value || '').trim();
    const pass = String(els.adminPassword?.value || '');
    if (user === ADMIN_FIXED_USER && pass === ADMIN_FIXED_PASSWORD) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
      if (els.adminLoginError) els.adminLoginError.textContent = '';
      unlockAdminApp();
      return;
    }
    if (els.adminLoginError) els.adminLoginError.textContent = 'Usuario ou senha invalidos.';
  });
  els.tabs.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  els.teamForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = els.teamName.value.trim();
    if (!name) return;
    state.teams.push({ id: uid(), name, color: els.teamColor.value || '#0f766e', createdAt: Date.now() });
    els.teamForm.reset();
    els.teamColor.value = '#0f766e';
    persistAndRender();
  });

  els.playerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = els.playerName.value.trim();
    if (!name) return;
    const photoDataUrl = els.playerPhoto.files?.[0] ? await fileToDataURL(els.playerPhoto.files[0]) : '';
    state.players.push({
      id: uid(),
      name,
      number: toNumOrNull(els.playerNumber.value),
      position: els.playerPosition.value,
      teamId: els.playerTeamId.value || '',
      userId: els.playerUserId?.value || '',
      photoDataUrl,
      yellowCards: 0,
      redCards: 0,
      goals: 0,
      createdAt: Date.now()
    });
    els.playerForm.reset();
    persistAndRender();
  });

  els.playerSearch.addEventListener('input', renderPlayers);

  els.eventSettingsForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    state.settings = state.settings || { eventStartAt: '' };
    state.settings.eventStartAt = String(els.eventStartAt?.value || '');
    if (els.eventSettingsMessage) {
      els.eventSettingsMessage.textContent = state.settings.eventStartAt
        ? 'Horário salvo para a contagem regressiva do app do jogador.'
        : 'Horário removido. O jogador verá sem contagem configurada.';
    }
    persistAndRender();
  });

  els.addGoalBtn.addEventListener('click', () => {
    const playerId = els.goalPlayerSelect.value;
    if (!playerId) return;
    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;
    pendingGoalEvents.push({ playerId: player.id, playerName: player.name });
    renderGoalEvents();
  });

  els.matchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const teamAId = els.matchTeamA.value;
    const teamBId = els.matchTeamB.value;
    if (!teamAId || !teamBId || teamAId === teamBId) {
      alert('Selecione dois times diferentes.');
      return;
    }
    const goalsA = Number(els.matchGoalsA.value || 0);
    const goalsB = Number(els.matchGoalsB.value || 0);
    const goalEvents = [...pendingGoalEvents];
    state.matches.push({
      id: uid(), teamAId, teamBId, goalsA, goalsB,
      stage: els.matchStage.value, date: els.matchDate.value || '', goalEvents, createdAt: Date.now()
    });
    goalEvents.forEach((g) => {
      const p = state.players.find((x) => x.id === g.playerId);
      if (p) p.goals = (p.goals || 0) + 1;
    });
    pendingGoalEvents = [];
    els.matchForm.reset();
    els.matchGoalsA.value = '0';
    els.matchGoalsB.value = '0';
    renderGoalEvents();
    persistAndRender();
  });

  els.generateBracketBtn.addEventListener('click', generateBracketFromTeams);

  els.penaltyDialog.addEventListener('close', () => {
    const action = els.penaltyDialog.returnValue;
    if (!selectedPenaltyPlayerId || !action || action === 'cancel') { selectedPenaltyPlayerId = null; return; }
    const p = state.players.find((x) => x.id === selectedPenaltyPlayerId);
    if (!p) return;
    if (action === 'yellow') p.yellowCards = (p.yellowCards || 0) + 1;
    if (action === 'red') p.redCards = (p.redCards || 0) + 1;
    selectedPenaltyPlayerId = null;
    persistAndRender();
  });

  els.resetDataBtn.addEventListener('click', () => {
    if (!confirm('Apagar todos os dados do campeonato?')) return;
    localStorage.removeItem(STORAGE_KEY);
    const fresh = defaultState();
    state.teams = fresh.teams; state.players = fresh.players; state.matches = fresh.matches; state.bracket = fresh.bracket; state.settings = fresh.settings;
    pendingGoalEvents = [];
    renderGoalEvents();
    persistAndRender();
  });
}

function switchTab(tabName) {
  els.tabs.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.tab === tabName));
  els.panels.forEach((panel) => {
    const active = panel.id === `tab-${tabName}`;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });
}

function bootstrapAdminGate() {
  const ok = sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
  if (ok) unlockAdminApp(); else lockAdminApp();
}

function lockAdminApp() {
  document.body.classList.add('admin-locked');
  if (els.adminLoginGate) {
    els.adminLoginGate.hidden = false;
    els.adminLoginGate.style.display = 'grid';
    els.adminLoginGate.style.pointerEvents = 'auto';
  }
}

function unlockAdminApp() {
  document.body.classList.remove('admin-locked');
  if (els.adminLoginGate) {
    els.adminLoginGate.hidden = true;
    els.adminLoginGate.style.display = 'none';
    els.adminLoginGate.style.pointerEvents = 'none';
  }
}

function renderAll() {
  renderEventSettings();
  renderTeamOptions();
  renderUserOptions();
  renderPlayerGoalOptions();
  renderTeams();
  renderPlayers();
  renderMatches();
  renderBracket();
  renderRankings();
}

function renderEventSettings() {
  state.settings = state.settings || { eventStartAt: '' };
  if (els.eventStartAt) {
    els.eventStartAt.value = String(state.settings.eventStartAt || '');
  }
}

function renderTeamOptions() {
  const teams = [...state.teams].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const options = teams.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  const keepPlayerTeam = els.playerTeamId.value;
  const keepA = els.matchTeamA.value;
  const keepB = els.matchTeamB.value;
  els.playerTeamId.innerHTML = `<option value="">Sem time</option>${options}`;
  els.matchTeamA.innerHTML = `<option value="">Selecione</option>${options}`;
  els.matchTeamB.innerHTML = `<option value="">Selecione</option>${options}`;
  if (keepPlayerTeam) els.playerTeamId.value = keepPlayerTeam;
  if (keepA) els.matchTeamA.value = keepA;
  if (keepB) els.matchTeamB.value = keepB;
}

function renderUserOptions() {
  if (!els.playerUserId) return;
  const keep = els.playerUserId.value;
  const options = [...registeredUsers]
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
    .map((u) => `<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.email)})</option>`)
    .join('');
  els.playerUserId.innerHTML = `<option value="">Sem vínculo (jogador ainda não se cadastrou)</option>${options}`;
  if (keep) els.playerUserId.value = keep;
}

function renderPlayerGoalOptions() {
  const keep = els.goalPlayerSelect.value;
  const items = [...state.players].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  els.goalPlayerSelect.innerHTML = `<option value="">Selecione</option>` + items.map((p) => {
    const t = findTeam(p.teamId);
    return `<option value="${esc(p.id)}">${esc(p.name)}${t ? ` (${esc(t.name)})` : ''}</option>`;
  }).join('');
  if (keep) els.goalPlayerSelect.value = keep;
}
function renderPlayers() {
  const term = (els.playerSearch.value || '').trim().toLowerCase();
  const players = [...state.players]
    .filter((p) => p.name.toLowerCase().includes(term))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  if (!players.length) {
    els.playersList.innerHTML = '<p class="muted">Nenhum jogador cadastrado.</p>';
    return;
  }

  els.playersList.innerHTML = players.map((p) => renderPlayerCard(p)).join('');

  els.playersList.querySelectorAll('[data-player-photo]').forEach((btn) => btn.addEventListener('click', () => openPenaltyDialog(btn.dataset.playerPhoto)));
  els.playersList.querySelectorAll('[data-player-delete]').forEach((btn) => btn.addEventListener('click', () => deletePlayer(btn.dataset.playerDelete)));
  els.playersList.querySelectorAll('[data-player-reset-cards]').forEach((btn) => btn.addEventListener('click', () => resetPlayerCards(btn.dataset.playerResetCards)));
}

function renderPlayerCard(player) {
  const team = findTeam(player.teamId);
  const linkedUser = registeredUsers.find((u) => u.id === player.userId);
  const teamNumbers = getTeamGoalsForAgainst(player.teamId);
  const photo = player.photoDataUrl
    ? `<img src="${esc(player.photoDataUrl)}" alt="Foto de ${esc(player.name)}">`
    : `<div class="player-photo-placeholder">${esc(initials(player.name))}</div>`;
  return `
    <article class="player-card">
      <button class="player-photo-wrap" type="button" data-player-photo="${esc(player.id)}" title="Clique para penalidade">
        ${photo}
        <div class="penalty-badges">
          ${player.yellowCards ? `<span class="penalty-chip yellow">🟨 ${player.yellowCards}</span>` : ''}
          ${player.redCards ? `<span class="penalty-chip red">🟥 ${player.redCards}</span>` : ''}
        </div>
        <div class="player-stat-badges">
          <span class="mini-chip">A ${Number(player.assists || 0)}</span>
          <span class="mini-chip">GP ${teamNumbers.gp}</span>
          <span class="mini-chip">GC ${teamNumbers.gc}</span>
        </div>
      </button>
      <div class="player-meta">
        <div class="player-name">${esc(player.name)} ${player.number !== null ? `#${player.number}` : ''}</div>
        <div class="player-sub">${esc(player.position || '-')} • ${esc(team?.name || 'Sem time')}</div>
        <div class="player-sub">${linkedUser ? `Conta: ${esc(linkedUser.email)}` : 'Conta: sem vínculo'}</div>
        <div class="player-sub">Gols: ${player.goals || 0}</div>
        <div class="mini-actions">
          <button class="ghost" type="button" data-player-reset-cards="${esc(player.id)}">Zerar cartões</button>
          <button class="danger" type="button" data-player-delete="${esc(player.id)}">Excluir</button>
        </div>
      </div>
    </article>`;
}

function getTeamGoalsForAgainst(teamId) {
  if (!teamId) return { gp: 0, gc: 0 };
  let gp = 0;
  let gc = 0;
  for (const m of state.matches) {
    if (m.teamAId !== teamId && m.teamBId !== teamId) continue;
    const isA = m.teamAId === teamId;
    gp += Number(isA ? m.goalsA : m.goalsB) || 0;
    gc += Number(isA ? m.goalsB : m.goalsA) || 0;
  }
  return { gp, gc };
}

function renderTeams() {
  const teams = [...state.teams].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (!teams.length) {
    els.teamsList.innerHTML = '<p class="muted">Cadastre os times para montar jogos e chaveamento.</p>';
    return;
  }
  els.teamsList.innerHTML = teams.map((team) => {
    const count = state.players.filter((p) => p.teamId === team.id).length;
    return `
      <article class="team-card">
        <div class="team-card-top">
          <div class="team-pill"><span class="team-dot" style="background:${esc(team.color)}"></span><span>${esc(team.name)}</span></div>
          <button class="danger" type="button" data-team-delete="${esc(team.id)}">Excluir</button>
        </div>
        <p class="muted">${count} jogador(es)</p>
      </article>`;
  }).join('');
  els.teamsList.querySelectorAll('[data-team-delete]').forEach((btn) => btn.addEventListener('click', () => deleteTeam(btn.dataset.teamDelete)));
}

function renderGoalEvents() {
  if (!pendingGoalEvents.length) {
    els.goalEvents.innerHTML = '<p class="muted">Nenhum gol por jogador adicionado.</p>';
    return;
  }
  els.goalEvents.innerHTML = pendingGoalEvents.map((ev, i) => `
    <div class="goal-event">
      <div><strong>${esc(ev.playerName)}</strong><small>Gol ${i + 1}</small></div>
      <button class="danger" type="button" data-goal-remove="${i}">Remover</button>
    </div>`).join('');
  els.goalEvents.querySelectorAll('[data-goal-remove]').forEach((btn) => btn.addEventListener('click', () => {
    pendingGoalEvents.splice(Number(btn.dataset.goalRemove), 1);
    renderGoalEvents();
  }));
}

function renderMatches() {
  const matches = [...state.matches].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  if (!matches.length) {
    els.matchesList.innerHTML = '<p class="muted">Nenhum jogo cadastrado.</p>';
    return;
  }
  els.matchesList.innerHTML = matches.map((m) => {
    const a = findTeam(m.teamAId)?.name || 'Time A';
    const b = findTeam(m.teamBId)?.name || 'Time B';
    const goals = (m.goalEvents || []).map((g) => esc(g.playerName)).join(', ');
    return `
      <article class="match-card">
        <div class="match-row"><strong>${esc(m.stage || 'Jogo')}</strong><button class="danger" type="button" data-match-delete="${esc(m.id)}">Excluir</button></div>
        <div class="match-row"><span>${esc(a)}</span><strong>${Number(m.goalsA)} x ${Number(m.goalsB)}</strong><span>${esc(b)}</span></div>
        <p class="muted">${m.date ? formatDate(m.date) : 'Sem data'}</p>
        ${(m.goalEvents || []).length ? `<p class="muted">Gols: ${goals}</p>` : ''}
      </article>`;
  }).join('');
  els.matchesList.querySelectorAll('[data-match-delete]').forEach((btn) => btn.addEventListener('click', () => deleteMatch(btn.dataset.matchDelete)));
}

function renderBracket() {
  const fromMatches = buildBracketFromMatches();
  const bracket = fromMatches.length ? fromMatches : state.bracket;
  if (!bracket.length) {
    els.bracketBoard.innerHTML = '<p class="muted">Sem chaveamento ainda. Cadastre jogos de mata-mata ou clique em "Gerar a partir dos times".</p>';
    return;
  }
  const stages = ['Quartas', 'Semifinal', 'Final'];
  els.bracketBoard.innerHTML = stages.map((stage) => {
    const games = bracket.filter((g) => g.stage === stage);
    if (!games.length) return '';
    return `
      <section class="bracket-stage">
        <h3>${stage}</h3>
        <div class="matches-list">
          ${games.map((g) => `
            <div class="bracket-match">
              <div class="bracket-team"><span>${esc(g.teamAName || 'A definir')}</span><strong>${g.scoreA ?? '-'}</strong></div>
              <div class="bracket-team"><span>${esc(g.teamBName || 'A definir')}</span><strong>${g.scoreB ?? '-'}</strong></div>
            </div>`).join('')}
        </div>
      </section>`;
  }).join('');
}

function buildBracketFromMatches() {
  return state.matches
    .filter((m) => ['Quartas', 'Semifinal', 'Final'].includes(m.stage))
    .sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage) || (a.date || '').localeCompare(b.date || ''))
    .map((m) => ({
      stage: m.stage,
      teamAName: findTeam(m.teamAId)?.name || 'Time A',
      teamBName: findTeam(m.teamBId)?.name || 'Time B',
      scoreA: Number(m.goalsA),
      scoreB: Number(m.goalsB)
    }));
}

function generateBracketFromTeams() {
  const teams = [...state.teams].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (teams.length < 2) { alert('Cadastre pelo menos 2 times.'); return; }
  const limited = teams.slice(0, 8);
  const pairs = [];
  for (let i = 0; i < limited.length; i += 2) pairs.push([limited[i], limited[i + 1]]);
  const generated = [];
  if (limited.length > 4) {
    pairs.forEach((pair) => generated.push({ stage: 'Quartas', teamAName: pair[0]?.name || 'A definir', teamBName: pair[1]?.name || 'A definir', scoreA: null, scoreB: null }));
    generated.push({ stage: 'Semifinal', teamAName: 'Vencedor Q1', teamBName: 'Vencedor Q2', scoreA: null, scoreB: null });
    if (pairs.length > 2) generated.push({ stage: 'Semifinal', teamAName: 'Vencedor Q3', teamBName: 'Vencedor Q4', scoreA: null, scoreB: null });
    generated.push({ stage: 'Final', teamAName: 'Vencedor S1', teamBName: 'Vencedor S2', scoreA: null, scoreB: null });
  } else {
    if (pairs.length === 2) {
      generated.push({ stage: 'Semifinal', teamAName: pairs[0][0]?.name || 'A definir', teamBName: pairs[0][1]?.name || 'A definir', scoreA: null, scoreB: null });
      generated.push({ stage: 'Semifinal', teamAName: pairs[1][0]?.name || 'A definir', teamBName: pairs[1][1]?.name || 'A definir', scoreA: null, scoreB: null });
    } else {
      generated.push({ stage: 'Semifinal', teamAName: limited[0]?.name || 'A definir', teamBName: limited[1]?.name || 'A definir', scoreA: null, scoreB: null });
    }
    generated.push({ stage: 'Final', teamAName: 'Vencedor S1', teamBName: 'Vencedor S2', scoreA: null, scoreB: null });
  }
  state.bracket = generated;
  persistAndRender();
}
function renderRankings() {
  const players = [...state.players].map((p) => ({ ...p, rankingPoints: (p.goals || 0) * 3 - (p.yellowCards || 0) - (p.redCards || 0) * 3 }))
    .sort((a, b) => b.rankingPoints - a.rankingPoints || (b.goals || 0) - (a.goals || 0) || a.name.localeCompare(b.name, 'pt-BR'));

  if (!players.length) {
    els.playerRanking.innerHTML = '<p class="muted">Sem jogadores para ranking.</p>';
  } else {
    els.playerRanking.innerHTML = `
      <table><thead><tr><th>#</th><th>Jogador</th><th>Time</th><th>Gols</th><th>🟨</th><th>🟥</th><th>Pontos</th></tr></thead><tbody>
      ${players.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(findTeam(p.teamId)?.name || '-')}</td><td>${p.goals || 0}</td><td>${p.yellowCards || 0}</td><td>${p.redCards || 0}</td><td>${p.rankingPoints}</td></tr>`).join('')}
      </tbody></table>`;
  }

  const table = state.teams.map((team) => {
    const matches = state.matches.filter((m) => m.teamAId === team.id || m.teamBId === team.id);
    let pts = 0, v = 0, e = 0, d = 0, gp = 0, gc = 0;
    matches.forEach((m) => {
      const isA = m.teamAId === team.id;
      const pro = Number(isA ? m.goalsA : m.goalsB);
      const con = Number(isA ? m.goalsB : m.goalsA);
      gp += pro; gc += con;
      if (pro > con) { pts += 3; v++; } else if (pro === con) { pts += 1; e++; } else { d++; }
    });
    return { team, j: matches.length, v, e, d, gp, gc, sg: gp - gc, pts };
  }).sort((a, b) => b.pts - a.pts || b.sg - a.sg || b.gp - a.gp || a.team.name.localeCompare(b.team.name, 'pt-BR'));

  if (!table.length) {
    els.teamRanking.innerHTML = '<p class="muted">Sem times para tabela.</p>';
    return;
  }

  els.teamRanking.innerHTML = `
    <table><thead><tr><th>#</th><th>Time</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th><th>Pts</th></tr></thead><tbody>
    ${table.map((r, i) => `<tr><td>${i + 1}</td><td><span class="team-pill"><span class="team-dot" style="background:${esc(r.team.color)}"></span>${esc(r.team.name)}</span></td><td>${r.j}</td><td>${r.v}</td><td>${r.e}</td><td>${r.d}</td><td>${r.gp}</td><td>${r.gc}</td><td>${r.sg}</td><td><strong>${r.pts}</strong></td></tr>`).join('')}
    </tbody></table>`;
}

function openPenaltyDialog(playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  selectedPenaltyPlayerId = playerId;
  els.penaltyDialogTitle.textContent = `Penalidade - ${player.name}`;
  if (typeof els.penaltyDialog.showModal === 'function') {
    els.penaltyDialog.showModal();
    return;
  }
  const ans = prompt(`Penalidade para ${player.name}: 1=amarelo, 2=vermelho`);
  if (ans === '1') { player.yellowCards = (player.yellowCards || 0) + 1; persistAndRender(); }
  if (ans === '2') { player.redCards = (player.redCards || 0) + 1; persistAndRender(); }
}

function deletePlayer(id) {
  const player = state.players.find((p) => p.id === id);
  if (!player || !confirm(`Excluir jogador ${player.name}?`)) return;
  state.players = state.players.filter((p) => p.id !== id);
  state.matches = state.matches.map((m) => ({ ...m, goalEvents: (m.goalEvents || []).filter((g) => g.playerId !== id) }));
  persistAndRender();
}

function resetPlayerCards(id) {
  const player = state.players.find((p) => p.id === id);
  if (!player) return;
  player.yellowCards = 0;
  player.redCards = 0;
  persistAndRender();
}

function deleteTeam(id) {
  const team = state.teams.find((t) => t.id === id);
  if (!team) return;
  if (state.matches.some((m) => m.teamAId === id || m.teamBId === id)) { alert('Esse time já tem jogos cadastrados. Exclua os jogos antes.'); return; }
  if (!confirm(`Excluir time ${team.name}?`)) return;
  state.teams = state.teams.filter((t) => t.id !== id);
  state.players = state.players.map((p) => p.teamId === id ? { ...p, teamId: '' } : p);
  persistAndRender();
}

function deleteMatch(id) {
  const match = state.matches.find((m) => m.id === id);
  if (!match || !confirm('Excluir jogo?')) return;
  (match.goalEvents || []).forEach((g) => {
    const p = state.players.find((x) => x.id === g.playerId);
    if (p) p.goals = Math.max(0, (p.goals || 0) - 1);
  });
  state.matches = state.matches.filter((m) => m.id !== id);
  persistAndRender();
}

function findTeam(teamId) { return state.teams.find((t) => t.id === teamId); }
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function toNumOrNull(v) { if (String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function initials(name) { return String(name).split(/\s+/).slice(0, 2).map((p) => (p[0] || '').toUpperCase()).join(''); }
function esc(v) { return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function formatDate(v) { const [y, m, d] = String(v).split('-'); return y && m && d ? `${d}/${m}/${y}` : String(v); }
function stageOrder(stage) { return { Quartas: 1, Semifinal: 2, Final: 3 }[stage] || 99; }

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function bootstrapRemote() {
  await Promise.allSettled([fetchUsersForLinking(), hydrateStateFromServer()]);
}

function startRemotePolling() {
  if (remotePollTimer) clearInterval(remotePollTimer);
  remotePollTimer = setInterval(() => {
    // Evita sobrescrever formulário enquanto admin está digitando.
    const activeTag = document.activeElement && document.activeElement.tagName ? document.activeElement.tagName : '';
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return;
    fetchUsersForLinking().catch(() => {});
    hydrateStateFromServer().catch(() => {});
  }, 10000);
}

function queueServerSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncStateToServer().catch(() => {});
  }, 250);
}

async function hydrateStateFromServer() {
  try {
    const data = await apiJson('/api/state');
    if (!data || !data.tournament) return;
    const t = data.tournament;
    state.teams = Array.isArray(t.teams) ? t.teams : [];
    state.players = Array.isArray(t.players) ? t.players : [];
    state.matches = Array.isArray(t.matches) ? t.matches : [];
    state.bracket = Array.isArray(t.bracket) ? t.bracket : [];
    state.settings = { eventStartAt: String(t?.settings?.eventStartAt || '') };
    saveState();
    renderAll();
  } catch {
    // fallback localStorage already loaded
  }
}

async function fetchUsersForLinking() {
  try {
    const data = await apiJson('/api/users');
    registeredUsers = Array.isArray(data.users) ? data.users : [];
    renderUserOptions();
  } catch {
    registeredUsers = [];
    renderUserOptions();
  }
}

async function syncStateToServer() {
  await apiJson('/api/state', {
    method: 'PUT',
    body: JSON.stringify({ tournament: state })
  });
  await fetchUsersForLinking();
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
  return data;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}







