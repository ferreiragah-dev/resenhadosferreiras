const STORAGE_KEY = "resenha-ferreira-campeonato-v1";
const ADMIN_SESSION_KEY = "resenha-ferreira-admin-auth";
const ADMIN_FIXED_USER = "admin";
const ADMIN_FIXED_PASSWORD = "ferreiras123@";
const state = loadState();
let selectedPenaltyPlayerId = null;
let selectedTeamChangePlayerId = null;
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
  teamLogo: document.getElementById('teamLogo'),
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
  scheduleForm: document.getElementById('scheduleForm'),
  schedulePhase: document.getElementById('schedulePhase'),
  scheduleTime: document.getElementById('scheduleTime'),
  scheduleTeamALabel: document.getElementById('scheduleTeamALabel'),
  scheduleTeamBLabel: document.getElementById('scheduleTeamBLabel'),
  scheduleTeamAId: document.getElementById('scheduleTeamAId'),
  scheduleTeamBId: document.getElementById('scheduleTeamBId'),
  scheduleTeamASelectWrap: document.getElementById('scheduleTeamASelectWrap'),
  scheduleTeamBSelectWrap: document.getElementById('scheduleTeamBSelectWrap'),
  scheduleGroupLabel: document.getElementById('scheduleGroupLabel'),
  scheduleList: document.getElementById('scheduleList'),
  loadScheduleTemplateBtn: document.getElementById('loadScheduleTemplateBtn'),
  sortScheduleBtn: document.getElementById('sortScheduleBtn'),
  goalPlayerSelect: document.getElementById('goalPlayerSelect'),
  addGoalBtn: document.getElementById('addGoalBtn'),
  goalEvents: document.getElementById('goalEvents'),
  bracketBoard: document.getElementById('bracketBoard'),
  generateBracketBtn: document.getElementById('generateBracketBtn'),
  playerRanking: document.getElementById('playerRanking'),
  teamRanking: document.getElementById('teamRanking'),
  penaltyDialog: document.getElementById('penaltyDialog'),
  penaltyDialogTitle: document.getElementById('penaltyDialogTitle'),
  teamChangeDialog: document.getElementById('teamChangeDialog'),
  teamChangeDialogTitle: document.getElementById('teamChangeDialogTitle'),
  teamChangeSelect: document.getElementById('teamChangeSelect'),
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
  return { teams: [], players: [], matches: [], gameSchedule: [], bracket: [], settings: { eventStartAt: '' } };
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
      gameSchedule: Array.isArray(parsed.gameSchedule) ? parsed.gameSchedule : [],
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

  els.teamForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = els.teamName.value.trim();
    if (!name) return;
    const logoDataUrl = els.teamLogo?.files?.[0] ? await fileToDataURL(els.teamLogo.files[0]) : '';
    state.teams.push({
      id: uid(),
      name,
      color: els.teamColor.value || '#0f766e',
      logoDataUrl,
      stats: defaultTeamStats(),
      createdAt: Date.now()
    });
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
      assists: 0,
      goalsPro: 0,
      goalsContra: 0,
      isCaptain: false,
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

  els.scheduleForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const phase = String(els.schedulePhase?.value || '').trim();
    const time = String(els.scheduleTime?.value || '').trim();
    const isGroup = isGroupPhase(phase);
    let teamALabel = String(els.scheduleTeamALabel?.value || '').trim();
    let teamBLabel = String(els.scheduleTeamBLabel?.value || '').trim();
    let teamAId = '';
    let teamBId = '';
    if (isGroup) {
      teamAId = String(els.scheduleTeamAId?.value || '').trim();
      teamBId = String(els.scheduleTeamBId?.value || '').trim();
      if (!teamAId || !teamBId || teamAId === teamBId) {
        alert('Na fase de grupos, selecione dois times diferentes.');
        return;
      }
      const teamA = findTeam(teamAId);
      const teamB = findTeam(teamBId);
      teamALabel = String(teamA?.name || '').trim();
      teamBLabel = String(teamB?.name || '').trim();
    }
    const groupLabel = String(els.scheduleGroupLabel?.value || '').trim();
    if (!phase || !time || !teamALabel || !teamBLabel) return;
    state.gameSchedule.push({
      id: uid(),
      phase,
      time,
      teamALabel,
      teamBLabel,
      teamAId,
      teamBId,
      groupLabel,
      createdAt: Date.now()
    });
    els.scheduleForm.reset();
    syncScheduleFormMode();
    persistAndRender();
  });

  els.schedulePhase?.addEventListener('input', syncScheduleFormMode);

  els.sortScheduleBtn?.addEventListener('click', () => {
    state.gameSchedule = [...(state.gameSchedule || [])].sort((a, b) => {
      const phaseCmp = String(a.phase || '').localeCompare(String(b.phase || ''), 'pt-BR');
      if (phaseCmp) return phaseCmp;
      return String(a.time || '').localeCompare(String(b.time || ''));
    });
    persistAndRender();
  });

  els.loadScheduleTemplateBtn?.addEventListener('click', loadDefaultScheduleTemplate);

  els.generateBracketBtn.addEventListener('click', generateBracketFromTeams);

  els.penaltyDialog.addEventListener('close', () => {
    const action = els.penaltyDialog.returnValue;
    if (!selectedPenaltyPlayerId || !action || action === 'cancel') { selectedPenaltyPlayerId = null; return; }
    const p = state.players.find((x) => x.id === selectedPenaltyPlayerId);
    if (!p) return;
    if (action === 'yellow') applyPlayerRelatedDelta(p, 'yellowCards', 1);
    if (action === 'red') applyPlayerRelatedDelta(p, 'redCards', 1);
    selectedPenaltyPlayerId = null;
    persistAndRender();
  });

  els.teamChangeDialog?.addEventListener('close', () => {
    const action = els.teamChangeDialog.returnValue;
    if (!selectedTeamChangePlayerId || action !== 'save') { selectedTeamChangePlayerId = null; return; }
    const player = state.players.find((p) => p.id === selectedTeamChangePlayerId);
    if (!player) { selectedTeamChangePlayerId = null; return; }
    player.teamId = String(els.teamChangeSelect?.value || '');
    selectedTeamChangePlayerId = null;
    persistAndRender();
  });

  els.resetDataBtn.addEventListener('click', () => {
    if (!confirm('Apagar todos os dados do campeonato?')) return;
    localStorage.removeItem(STORAGE_KEY);
    const fresh = defaultState();
    state.teams = fresh.teams; state.players = fresh.players; state.matches = fresh.matches; state.gameSchedule = fresh.gameSchedule; state.bracket = fresh.bracket; state.settings = fresh.settings;
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
  syncScheduleFormMode();
  renderUserOptions();
  renderPlayerGoalOptions();
  renderTeams();
  renderPlayers();
  renderMatches();
  renderSchedule();
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
  const keepScheduleA = String(els.scheduleTeamAId?.value || '');
  const keepScheduleB = String(els.scheduleTeamBId?.value || '');
  els.playerTeamId.innerHTML = `<option value="">Sem time</option>${options}`;
  els.matchTeamA.innerHTML = `<option value="">Selecione</option>${options}`;
  els.matchTeamB.innerHTML = `<option value="">Selecione</option>${options}`;
  if (els.scheduleTeamAId) els.scheduleTeamAId.innerHTML = `<option value="">Selecione</option>${options}`;
  if (els.scheduleTeamBId) els.scheduleTeamBId.innerHTML = `<option value="">Selecione</option>${options}`;
  if (keepPlayerTeam) els.playerTeamId.value = keepPlayerTeam;
  if (keepA) els.matchTeamA.value = keepA;
  if (keepB) els.matchTeamB.value = keepB;
  if (els.scheduleTeamAId && keepScheduleA) els.scheduleTeamAId.value = keepScheduleA;
  if (els.scheduleTeamBId && keepScheduleB) els.scheduleTeamBId.value = keepScheduleB;
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
  els.playersList.querySelectorAll('[data-player-change-team]').forEach((btn) => {
    btn.addEventListener('click', () => openTeamChangeDialog(btn.dataset.playerChangeTeam));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openTeamChangeDialog(btn.dataset.playerChangeTeam);
      }
    });
  });
  els.playersList.querySelectorAll('[data-player-delete]').forEach((btn) => btn.addEventListener('click', () => deletePlayer(btn.dataset.playerDelete)));
  els.playersList.querySelectorAll('[data-player-reset-cards]').forEach((btn) => btn.addEventListener('click', () => resetPlayerCards(btn.dataset.playerResetCards)));
  els.playersList.querySelectorAll('[data-player-add-assist]').forEach((btn) => btn.addEventListener('click', () => addPlayerAssist(btn.dataset.playerAddAssist)));
  els.playersList.querySelectorAll('[data-player-reset-ags]').forEach((btn) => btn.addEventListener('click', () => resetPlayerAGS(btn.dataset.playerResetAgs)));
  els.playersList.querySelectorAll('[data-player-stat-op]').forEach((btn) => btn.addEventListener('click', () => {
    const [id, field, delta] = String(btn.dataset.playerStatOp || '').split('|');
    changePlayerStat(id, field, Number(delta || 0));
  }));
  els.playersList.querySelectorAll('[data-player-toggle-captain]').forEach((btn) => btn.addEventListener('click', () => togglePlayerCaptain(btn.dataset.playerToggleCaptain)));
}

function renderPlayerCard(player) {
  const team = findTeam(player.teamId);
  const linkedUser = registeredUsers.find((u) => u.id === player.userId);
  const isTopScorer = getTopScorerId() === player.id;
  const teamNumbers = getTeamGoalsForAgainst(player.teamId);
  const playerGP = Number((player.goalsPro ?? teamNumbers.gp) || 0);
  const playerGC = Number((player.goalsContra ?? teamNumbers.gc) || 0);
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
          ${player.isCaptain ? `<span class="mini-chip captain-chip">C Capitão</span>` : ''}
          ${isTopScorer ? `<span class="mini-chip topscorer-chip">⚽ Artilheiro</span>` : ''}
          <span class="mini-chip">A ${Number(player.assists || 0)}</span>
          <span class="mini-chip">GP ${playerGP}</span>
          <span class="mini-chip">GC ${playerGC}</span>
        </div>
      </button>
      <div class="player-meta">
        <div class="player-name" role="button" tabindex="0" title="Clique para trocar time" data-player-change-team="${esc(player.id)}">${esc(player.name)} ${player.number !== null ? `#${player.number}` : ''}</div>
        <div class="player-sub">${esc(player.position || '-')} • ${esc(team?.name || 'Sem time')}</div>
        <div class="player-sub">${linkedUser ? `Conta: ${esc(linkedUser.email)}` : 'Conta: sem vínculo'}</div>
        <div class="player-sub">Capitão: ${player.isCaptain ? 'Sim' : 'Não'}</div>
        <div class="player-sub">Gols: ${player.goals || 0}</div>
        <div class="stat-crud-grid">
          <button class="ghost" type="button" data-player-stat-op="${esc(player.id)}|assists|1">A +1</button>
          <button class="ghost" type="button" data-player-stat-op="${esc(player.id)}|assists|-1">A -1</button>
          <button class="ghost" type="button" data-player-stat-op="${esc(player.id)}|goalsPro|1">GP +1</button>
          <button class="ghost" type="button" data-player-stat-op="${esc(player.id)}|goalsPro|-1">GP -1</button>
          <button class="ghost" type="button" data-player-stat-op="${esc(player.id)}|goalsContra|1">GC +1</button>
          <button class="ghost" type="button" data-player-stat-op="${esc(player.id)}|goalsContra|-1">GC -1</button>
        </div>
        <div class="mini-actions">
          <button class="ghost" type="button" data-player-toggle-captain="${esc(player.id)}">${player.isCaptain ? 'Remover C' : 'Tornar C'}</button>
          <button class="ghost" type="button" data-player-add-assist="${esc(player.id)}">Assist +1</button>
          <button class="ghost" type="button" data-player-reset-ags="${esc(player.id)}">Zerar A/GP/GC</button>
          <button class="ghost" type="button" data-player-reset-cards="${esc(player.id)}">Zerar cartões</button>
          <button class="danger" type="button" data-player-delete="${esc(player.id)}">Excluir</button>
        </div>
      </div>
    </article>`;
}

function getTopScorerId() {
  let best = null;
  state.players.forEach((p) => {
    const goals = Math.max(0, Number(p.goals || 0));
    if (!goals) return;
    if (!best) {
      best = { id: p.id, goals, name: String(p.name || '') };
      return;
    }
    if (goals > best.goals) {
      best = { id: p.id, goals, name: String(p.name || '') };
      return;
    }
    if (goals === best.goals && String(p.name || '').localeCompare(best.name, 'pt-BR') < 0) {
      best = { id: p.id, goals, name: String(p.name || '') };
    }
  });
  return best ? best.id : '';
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

function defaultTeamStats() {
  return { points: 0, games: 0, wins: 0, draws: 0, losses: 0, goalsPro: 0, goalsContra: 0, goalDiff: 0 };
}

function getTeamManualStats(team) {
  const s = team && team.stats && typeof team.stats === 'object' ? team.stats : {};
  return {
    points: Number(s.points || 0),
    games: Number(s.games || 0),
    wins: Number(s.wins || 0),
    draws: Number(s.draws || 0),
    losses: Number(s.losses || 0),
    goalsPro: Number(s.goalsPro || 0),
    goalsContra: Number(s.goalsContra || 0),
    goalDiff: Number(s.goalDiff || 0)
  };
}

function saveTeamStatsFromCard(teamId) {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return;
  const stats = defaultTeamStats();
  document.querySelectorAll(`[data-team-stat-input^="${cssEscape(teamId)}|"]`).forEach((input) => {
    const parts = String(input.dataset.teamStatInput || '').split('|');
    if (parts.length !== 2) return;
    const field = parts[1];
    if (!(field in stats)) return;
    stats[field] = Math.max(0, Number(input.value || 0));
  });
  team.stats = stats;
  persistAndRender();
}

function resetTeamStats(teamId) {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return;
  team.stats = defaultTeamStats();
  persistAndRender();
}

function renderTeams() {
  const teams = [...state.teams].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (!teams.length) {
    els.teamsList.innerHTML = '<p class="muted">Cadastre os times para montar jogos e chaveamento.</p>';
    return;
  }
  els.teamsList.innerHTML = teams.map((team) => {
    const count = state.players.filter((p) => p.teamId === team.id).length;
    const s = getTeamManualStats(team);
    return `
      <article class="team-card">
        <div class="team-card-top">
          <div class="team-pill">${teamIdentityHtml(team)}</div>
          <button class="danger" type="button" data-team-delete="${esc(team.id)}">Excluir</button>
        </div>
        <div class="team-edit-grid">
          <label>Nome do time
            <input type="text" value="${esc(team.name)}" data-team-basic-input="${esc(team.id)}|name">
          </label>
          <label>Cor
            <input type="color" value="${esc(team.color || '#0f766e')}" data-team-basic-input="${esc(team.id)}|color">
          </label>
          <label class="full">Logo (opcional)
            <input type="file" accept="image/*" data-team-logo-input="${esc(team.id)}">
          </label>
        </div>
        <p class="muted">${count} jogador(es)</p>
        <div class="team-stats-grid">
          ${teamStatInput(team.id, 'points', 'P', s.points)}
          ${teamStatInput(team.id, 'games', 'J', s.games)}
          ${teamStatInput(team.id, 'wins', 'V', s.wins)}
          ${teamStatInput(team.id, 'draws', 'E', s.draws)}
          ${teamStatInput(team.id, 'losses', 'D', s.losses)}
          ${teamStatInput(team.id, 'goalsPro', 'GP', s.goalsPro)}
          ${teamStatInput(team.id, 'goalsContra', 'GC', s.goalsContra)}
          ${teamStatInput(team.id, 'goalDiff', 'SG', s.goalDiff)}
        </div>
        <div class="mini-actions">
          <button class="ghost" type="button" data-team-save="${esc(team.id)}">Salvar time</button>
          <button class="ghost" type="button" data-team-stats-save="${esc(team.id)}">Salvar tabela</button>
          <button class="ghost" type="button" data-team-stats-reset="${esc(team.id)}">Zerar tabela</button>
        </div>
      </article>`;
  }).join('');
  els.teamsList.querySelectorAll('[data-team-delete]').forEach((btn) => btn.addEventListener('click', () => deleteTeam(btn.dataset.teamDelete)));
  els.teamsList.querySelectorAll('[data-team-save]').forEach((btn) => btn.addEventListener('click', async () => { await saveTeamBasicFromCard(btn.dataset.teamSave); }));
  els.teamsList.querySelectorAll('[data-team-stats-save]').forEach((btn) => btn.addEventListener('click', () => saveTeamStatsFromCard(btn.dataset.teamStatsSave)));
  els.teamsList.querySelectorAll('[data-team-stats-reset]').forEach((btn) => btn.addEventListener('click', () => resetTeamStats(btn.dataset.teamStatsReset)));
}

async function saveTeamBasicFromCard(teamId) {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return;
  const patch = { name: team.name, color: team.color || '#0f766e', logoDataUrl: team.logoDataUrl || '' };
  document.querySelectorAll(`[data-team-basic-input^="${cssEscape(teamId)}|"]`).forEach((input) => {
    const parts = String(input.dataset.teamBasicInput || '').split('|');
    if (parts.length !== 2) return;
    const field = parts[1];
    if (field === 'name') patch.name = String(input.value || '').trim();
    if (field === 'color') patch.color = String(input.value || '').trim() || '#0f766e';
  });
  const logoInput = document.querySelector(`[data-team-logo-input="${cssEscape(teamId)}"]`);
  if (logoInput && logoInput.files && logoInput.files[0]) {
    patch.logoDataUrl = await fileToDataURL(logoInput.files[0]);
  }
  if (!patch.name) {
    alert('Nome do time é obrigatório.');
    return;
  }
  team.name = patch.name;
  team.color = patch.color;
  team.logoDataUrl = patch.logoDataUrl;
  persistAndRender();
}

function teamIdentityHtml(team) {
  if (!team) return '<span>Time</span>';
  const logo = String(team.logoDataUrl || '').trim();
  if (logo) {
    return `<span class="team-logo"><img src="${esc(logo)}" alt="${esc(team.name || 'Time')}"></span><span>${esc(team.name || 'Time')}</span>`;
  }
  return `<span class="team-dot" style="background:${esc(team.color || '#0f766e')}"></span><span>${esc(team.name || 'Time')}</span>`;
}

function teamStatInput(teamId, field, label, value) {
  return `<label class="team-stat-field">${label}<input type="number" min="0" value="${Number(value || 0)}" data-team-stat-input="${esc(teamId)}|${field}"></label>`;
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
    const aTeam = findTeam(m.teamAId) || null;
    const bTeam = findTeam(m.teamBId) || null;
    const a = aTeam?.name || 'Time A';
    const b = bTeam?.name || 'Time B';
    const goals = (m.goalEvents || []).map((g) => esc(g.playerName)).join(', ');
    return `
      <article class="match-card">
        <div class="match-row"><strong>${esc(m.stage || 'Jogo')}</strong><button class="danger" type="button" data-match-delete="${esc(m.id)}">Excluir</button></div>
        <div class="match-row"><span class="team-inline">${teamInlineHtml(aTeam, a)}</span><strong>${Number(m.goalsA)} x ${Number(m.goalsB)}</strong><span class="team-inline">${teamInlineHtml(bTeam, b)}</span></div>
        <p class="muted">${m.date ? formatDate(m.date) : 'Sem data'}</p>
        ${(m.goalEvents || []).length ? `<p class="muted">Gols: ${goals}</p>` : ''}
      </article>`;
  }).join('');
  els.matchesList.querySelectorAll('[data-match-delete]').forEach((btn) => btn.addEventListener('click', () => deleteMatch(btn.dataset.matchDelete)));
}

function isGroupPhase(phase) {
  const text = String(phase || '').trim().toLowerCase();
  return text.includes('grupo');
}

function syncScheduleFormMode() {
  if (!els.schedulePhase || !els.scheduleTeamALabel || !els.scheduleTeamBLabel) return;
  const useTeamSelect = isGroupPhase(els.schedulePhase.value);
  if (els.scheduleTeamASelectWrap) els.scheduleTeamASelectWrap.hidden = !useTeamSelect;
  if (els.scheduleTeamBSelectWrap) els.scheduleTeamBSelectWrap.hidden = !useTeamSelect;
  const labelWrapA = els.scheduleTeamALabel.closest('label');
  const labelWrapB = els.scheduleTeamBLabel.closest('label');
  if (labelWrapA) labelWrapA.hidden = useTeamSelect;
  if (labelWrapB) labelWrapB.hidden = useTeamSelect;
  els.scheduleTeamALabel.required = !useTeamSelect;
  els.scheduleTeamBLabel.required = !useTeamSelect;
  if (els.scheduleTeamAId) els.scheduleTeamAId.required = useTeamSelect;
  if (els.scheduleTeamBId) els.scheduleTeamBId.required = useTeamSelect;
}

function scheduleTeamOptionsHtml(selectedId) {
  const teams = [...state.teams].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
  return `<option value="">Selecione</option>` + teams.map((t) => (
    `<option value="${esc(t.id)}"${String(selectedId || '') === String(t.id) ? ' selected' : ''}>${esc(t.name)}</option>`
  )).join('');
}

function resolveScheduleTeam(row, side) {
  const idField = side === 'A' ? 'teamAId' : 'teamBId';
  const labelField = side === 'A' ? 'teamALabel' : 'teamBLabel';
  const id = String(row?.[idField] || '').trim();
  if (id) {
    const byId = findTeam(id);
    if (byId) return byId;
  }
  return resolveTeamByLabel(row?.[labelField] || '');
}

function renderSchedule() {
  if (!els.scheduleList) return;
  const rows = Array.isArray(state.gameSchedule) ? [...state.gameSchedule] : [];
  if (!rows.length) {
    els.scheduleList.innerHTML = '<p class="muted">Nenhum item na agenda. Cadastre a fase, horário e confronto.</p>';
    return;
  }

  rows.sort((a, b) => {
    const phaseCmp = String(a.phase || '').localeCompare(String(b.phase || ''), 'pt-BR');
    if (phaseCmp) return phaseCmp;
    return String(a.time || '').localeCompare(String(b.time || ''));
  });

  let lastPhase = '';
  els.scheduleList.innerHTML = rows.map((row) => {
    const groupPhase = isGroupPhase(row.phase);
    const teamA = resolveScheduleTeam(row, 'A');
    const teamB = resolveScheduleTeam(row, 'B');
    const selectedAId = String(teamA?.id || row.teamAId || '');
    const selectedBId = String(teamB?.id || row.teamBId || '');
    const teamALabel = String(teamA?.name || row.teamALabel || '');
    const teamBLabel = String(teamB?.name || row.teamBLabel || '');
    const showPhase = String(row.phase || '') !== lastPhase;
    lastPhase = String(row.phase || '');
    return `
      ${showPhase ? `<div class="schedule-phase">${esc(row.phase || 'Fase')}</div>` : ''}
      <article class="schedule-card">
        <div class="schedule-grid">
          <label>Horário<input type="time" value="${esc(row.time || '')}" data-schedule-input="${esc(row.id)}|time"></label>
          <label>Grupo/Chave<input type="text" value="${esc(row.groupLabel || '')}" placeholder="Grupo A" data-schedule-input="${esc(row.id)}|groupLabel"></label>
          ${groupPhase
            ? `<label>Confronto A
                <select data-schedule-input="${esc(row.id)}|teamAId">
                  ${scheduleTeamOptionsHtml(selectedAId)}
                </select>
              </label>`
            : `<label>Confronto A<input type="text" value="${esc(teamALabel)}" data-schedule-input="${esc(row.id)}|teamALabel"></label>`
          }
          ${groupPhase
            ? `<label>Confronto B
                <select data-schedule-input="${esc(row.id)}|teamBId">
                  ${scheduleTeamOptionsHtml(selectedBId)}
                </select>
              </label>`
            : `<label>Confronto B<input type="text" value="${esc(teamBLabel)}" data-schedule-input="${esc(row.id)}|teamBLabel"></label>`
          }
          <label class="full">Fase<input type="text" value="${esc(row.phase || '')}" data-schedule-input="${esc(row.id)}|phase"></label>
        </div>
        <div class="mini-actions">
          <button class="primary" type="button" data-schedule-start="${esc(row.id)}">Iniciar jogo</button>
          <button class="ghost" type="button" data-schedule-save="${esc(row.id)}">Salvar</button>
          <button class="danger" type="button" data-schedule-delete="${esc(row.id)}">Excluir</button>
        </div>
      </article>`;
  }).join('');

  els.scheduleList.querySelectorAll('[data-schedule-start]').forEach((btn) => btn.addEventListener('click', () => startScheduledGame(btn.dataset.scheduleStart)));
  els.scheduleList.querySelectorAll('[data-schedule-save]').forEach((btn) => btn.addEventListener('click', () => saveScheduleRow(btn.dataset.scheduleSave)));
  els.scheduleList.querySelectorAll('[data-schedule-delete]').forEach((btn) => btn.addEventListener('click', () => deleteScheduleRow(btn.dataset.scheduleDelete)));
}

function saveScheduleRow(id) {
  const row = (state.gameSchedule || []).find((x) => x.id === id);
  if (!row) return;
  document.querySelectorAll(`[data-schedule-input^="${cssEscape(id)}|"]`).forEach((input) => {
    const parts = String(input.dataset.scheduleInput || '').split('|');
    if (parts.length !== 2) return;
    const field = parts[1];
    if (!['phase', 'time', 'teamALabel', 'teamBLabel', 'teamAId', 'teamBId', 'groupLabel'].includes(field)) return;
    row[field] = String(input.value || '').trim();
  });

  if (isGroupPhase(row.phase)) {
    const teamA = findTeam(String(row.teamAId || ''));
    const teamB = findTeam(String(row.teamBId || ''));
    if (!teamA || !teamB || String(teamA.id) === String(teamB.id)) {
      alert('Na fase de grupos, selecione dois times cadastrados e diferentes.');
      return;
    }
    row.teamALabel = String(teamA.name || '');
    row.teamBLabel = String(teamB.name || '');
  } else {
    row.teamAId = '';
    row.teamBId = '';
  }

  if (!row.phase || !row.time || !row.teamALabel || !row.teamBLabel) {
    alert('Fase, horário e confrontos são obrigatórios.');
    return;
  }
  persistAndRender();
}

function deleteScheduleRow(id) {
  const row = (state.gameSchedule || []).find((x) => x.id === id);
  if (!row) return;
  if (!confirm(`Excluir agenda ${row.time} - ${row.teamALabel} x ${row.teamBLabel}?`)) return;
  state.gameSchedule = (state.gameSchedule || []).filter((x) => x.id !== id);
  persistAndRender();
}

function startScheduledGame(id) {
  const row = (state.gameSchedule || []).find((x) => x.id === id);
  if (!row) return;

  const teamA = resolveScheduleTeam(row, 'A');
  const teamB = resolveScheduleTeam(row, 'B');

  if (!teamA || !teamB) {
    alert('Nao foi possivel iniciar: um ou ambos os confrontos nao correspondem a times cadastrados.');
    return;
  }
  if (teamA.id === teamB.id) {
    alert('Confronto invalido: os times devem ser diferentes.');
    return;
  }

  const url = '/jogo/ao-vivo?teamA=' + encodeURIComponent(teamA.id) +
    '&teamB=' + encodeURIComponent(teamB.id) +
    '&teamAName=' + encodeURIComponent(teamA.name) +
    '&teamBName=' + encodeURIComponent(teamB.name);
  window.location.href = url;
}

function resolveTeamByLabel(label) {
  const normalized = String(label || '').trim().toLowerCase();
  if (!normalized) return null;
  return state.teams.find((t) => String(t.name || '').trim().toLowerCase() === normalized) || null;
}

function loadDefaultScheduleTemplate() {
  const hasRows = Array.isArray(state.gameSchedule) && state.gameSchedule.length > 0;
  if (hasRows && !confirm('Substituir a agenda atual pela agenda padrão que você enviou?')) return;

  const now = Date.now();
  const rows = [
    ['FASE DE GRUPO (2x7 minutos)', '09:00', 'Time A', 'Time B', 'Grupo A'],
    ['FASE DE GRUPO (2x7 minutos)', '09:15', 'Time D', 'Time E', 'Grupo B'],
    ['FASE DE GRUPO (2x7 minutos)', '09:30', 'Time A', 'Time C', 'Grupo A'],
    ['FASE DE GRUPO (2x7 minutos)', '09:45', 'Time D', 'Time F', 'Grupo B'],
    ['FASE DE GRUPO (2x7 minutos)', '10:00', 'Time B', 'Time C', 'Grupo A'],
    ['FASE DE GRUPO (2x7 minutos)', '10:15', 'Time E', 'Time F', 'Grupo B'],
    ['SEMIFINAIS (2x7 minutos)', '10:45', '1º Grupo A', '2º Grupo B', ''],
    ['SEMIFINAIS (2x7 minutos)', '11:00', '1º Grupo B', '2º Grupo A', ''],
    ['FINAL (2x7 minutos)', '11:30', 'Vencedor SF1', 'Vencedor SF2', '']
  ];

  state.gameSchedule = rows.map((r, idx) => ({
    id: uid(),
    phase: r[0],
    time: r[1],
    teamALabel: r[2],
    teamBLabel: r[3],
    groupLabel: r[4],
    createdAt: now + idx
  }));

  persistAndRender();
  switchTab('jogos');
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
  const players = [...state.players]
    .map((p) => ({ ...p, rankingPoints: (p.goals || 0) * 3 - (p.yellowCards || 0) - (p.redCards || 0) * 3 }))
    .filter((p) => Number(p.goals || 0) > 0 || Number(p.yellowCards || 0) > 0 || Number(p.redCards || 0) > 0)
    .sort((a, b) => b.rankingPoints - a.rankingPoints || (b.goals || 0) - (a.goals || 0) || a.name.localeCompare(b.name, 'pt-BR'));

  if (!players.length) {
    els.playerRanking.innerHTML = '<p class="muted">Sem jogadores com gols ou cartões para ranking.</p>';
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
    ${table.map((r, i) => `<tr><td>${i + 1}</td><td><span class="team-pill">${teamIdentityHtml(r.team)}</span></td><td>${r.j}</td><td>${r.v}</td><td>${r.e}</td><td>${r.d}</td><td>${r.gp}</td><td>${r.gc}</td><td>${r.sg}</td><td><strong>${r.pts}</strong></td></tr>`).join('')}
    </tbody></table>`;
}

function teamInlineHtml(team, fallbackName) {
  const name = fallbackName || (team && team.name) || 'Time';
  if (team && team.logoDataUrl) {
    return `<span class="team-logo tiny"><img src="${esc(team.logoDataUrl)}" alt="${esc(name)}"></span><span>${esc(name)}</span>`;
  }
  if (team) {
    return `<span class="team-dot small" style="background:${esc(team.color || '#0f766e')}"></span><span>${esc(name)}</span>`;
  }
  return `<span>${esc(name)}</span>`;
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
  if (ans === '1') { applyPlayerRelatedDelta(player, 'yellowCards', 1); persistAndRender(); }
  if (ans === '2') { applyPlayerRelatedDelta(player, 'redCards', 1); persistAndRender(); }
}

function openTeamChangeDialog(playerId) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || !els.teamChangeDialog || !els.teamChangeSelect) return;
  selectedTeamChangePlayerId = playerId;
  if (els.teamChangeDialogTitle) {
    els.teamChangeDialogTitle.textContent = `Trocar time - ${player.name}`;
  }
  const options = ['<option value="">Sem time</option>']
    .concat(
      [...state.teams]
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
        .map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`)
    );
  els.teamChangeSelect.innerHTML = options.join('');
  els.teamChangeSelect.value = String(player.teamId || '');
  if (typeof els.teamChangeDialog.showModal === 'function') {
    els.teamChangeDialog.showModal();
    return;
  }
  const choices = ['Sem time'].concat(state.teams.map((t) => t.name));
  const ans = prompt(`Novo time para ${player.name}:\n${choices.join(' | ')}`);
  if (ans === null) { selectedTeamChangePlayerId = null; return; }
  const chosen = state.teams.find((t) => String(t.name || '').toLowerCase() === String(ans || '').trim().toLowerCase());
  player.teamId = chosen ? chosen.id : '';
  selectedTeamChangePlayerId = null;
  persistAndRender();
}

function deletePlayer(id) {
  const player = state.players.find((p) => p.id === id);
  if (!player || !confirm(`Excluir jogador ${player.name}?`)) return;
  state.players = state.players.filter((p) => p.id !== id);
  state.matches = state.matches.map((m) => ({ ...m, goalEvents: (m.goalEvents || []).filter((g) => g.playerId !== id) }));
  persistAndRender();
}

function resetPlayerCards(id) {
  resetAllPlayerStats(id);
}

function togglePlayerCaptain(id) {
  const player = state.players.find((p) => p.id === id);
  if (!player) return;
  player.isCaptain = !player.isCaptain;
  persistAndRender();
}

function addPlayerAssist(id) {
  const player = state.players.find((p) => p.id === id);
  if (!player) return;
  applyPlayerRelatedDelta(player, 'assists', 1);
  persistAndRender();
}

function changePlayerStat(id, field, delta) {
  const player = state.players.find((p) => p.id === id);
  if (!player) return;
  if (!['assists', 'goalsPro', 'goalsContra'].includes(field)) return;
  applyPlayerRelatedDelta(player, field, Number(delta || 0));
  persistAndRender();
}

function applyPlayerRelatedDelta(player, field, delta) {
  if (!player) return;
  const d = Number(delta || 0);
  if (!Number.isFinite(d) || d === 0) return;

  if (field === 'assists') {
    player.assists = Math.max(0, Number(player.assists || 0) + d);
    return;
  }

  if (field === 'goalsPro') {
    player.goalsPro = Math.max(0, Number(player.goalsPro || 0) + d);
    // GP manual do elenco deve refletir também no total de gols do jogador (ranking).
    player.goals = Math.max(0, Number(player.goals || 0) + d);
    return;
  }

  if (field === 'goalsContra') {
    player.goalsContra = Math.max(0, Number(player.goalsContra || 0) + d);
    return;
  }

  if (field === 'yellowCards') {
    player.yellowCards = Math.max(0, Number(player.yellowCards || 0) + d);
    return;
  }

  if (field === 'redCards') {
    player.redCards = Math.max(0, Number(player.redCards || 0) + d);
  }
}

function resetPlayerAGS(id) {
  resetAllPlayerStats(id);
}

function resetAllPlayerStats(id) {
  const player = state.players.find((p) => p.id === id);
  if (!player) return;
  const confirmed = confirm(`Zerar todos os dados do jogador ${player.name}? (gols, assistencias, GP/GC e cartoes)`);
  if (!confirmed) return;

  // Zera todos os acumuladores exibidos no elenco/ranking/app do jogador.
  player.goals = 0;
  player.assists = 0;
  player.goalsPro = 0;
  player.goalsContra = 0;
  player.yellowCards = 0;
  player.redCards = 0;

  // Remove atribuicao de gols desse jogador nos jogos cadastrados para manter consistencia do ranking.
  state.matches = state.matches.map((m) => ({
    ...m,
    goalEvents: Array.isArray(m.goalEvents) ? m.goalEvents.filter((g) => g.playerId !== id) : []
  }));

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
function cssEscape(v) { return String(v ?? '').replace(/["\\]/g, '\\$&'); }
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
    state.gameSchedule = Array.isArray(t.gameSchedule) ? t.gameSchedule : [];
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







