
const ADMIN_SESSION_KEY = "resenha-ferreira-admin-auth";
const ADMIN_FIXED_USER = "admin";
const ADMIN_FIXED_PASSWORD = "ferreiras123@";

const state = {
  teams: [], players: [], matches: [], gameSchedule: [], bracket: [], liveGame: null, recentGames: [], settings: { eventStartAt: "" }
};
let registeredUsers = [];
let pendingGoalEvents = [];
let selectedPenaltyPlayerId = null;
let selectedTeamChangePlayerId = null;
let loaded = false;
let saving = false;
let saveAgain = false;

const els = {
  tabs: [...document.querySelectorAll(".tab")],
  panels: [...document.querySelectorAll(".tab-panel")],
  adminLoginGate: document.getElementById("adminLoginGate"),
  adminLoginForm: document.getElementById("adminLoginForm"),
  adminUsername: document.getElementById("adminUsername"),
  adminPassword: document.getElementById("adminPassword"),
  adminLoginError: document.getElementById("adminLoginError"),
  resetDataBtn: document.getElementById("resetDataBtn"),
  resetStatsBtn: document.getElementById("resetStatsBtn"),
  playerForm: document.getElementById("playerForm"),
  playerName: document.getElementById("playerName"),
  playerNumber: document.getElementById("playerNumber"),
  playerPosition: document.getElementById("playerPosition"),
  playerTeamId: document.getElementById("playerTeamId"),
  playerUserId: document.getElementById("playerUserId"),
  playerPhoto: document.getElementById("playerPhoto"),
  playerSearch: document.getElementById("playerSearch"),
  playersList: document.getElementById("playersList"),
  teamForm: document.getElementById("teamForm"),
  teamName: document.getElementById("teamName"),
  teamColor: document.getElementById("teamColor"),
  teamLogo: document.getElementById("teamLogo"),
  teamsList: document.getElementById("teamsList"),
  matchForm: document.getElementById("matchForm"),
  matchTeamA: document.getElementById("matchTeamA"),
  matchTeamB: document.getElementById("matchTeamB"),
  matchGoalsA: document.getElementById("matchGoalsA"),
  matchGoalsB: document.getElementById("matchGoalsB"),
  matchStage: document.getElementById("matchStage"),
  matchDate: document.getElementById("matchDate"),
  goalPlayerSelect: document.getElementById("goalPlayerSelect"),
  addGoalBtn: document.getElementById("addGoalBtn"),
  goalEvents: document.getElementById("goalEvents"),
  matchesList: document.getElementById("matchesList"),
  eventSettingsForm: document.getElementById("eventSettingsForm"),
  eventStartAt: document.getElementById("eventStartAt"),
  eventSettingsMessage: document.getElementById("eventSettingsMessage"),
  pushTestForm: document.getElementById("pushTestForm"),
  pushTitle: document.getElementById("pushTitle"),
  pushBody: document.getElementById("pushBody"),
  pushUrl: document.getElementById("pushUrl"),
  pushUserId: document.getElementById("pushUserId"),
  pushTestMessage: document.getElementById("pushTestMessage"),
  scheduleForm: document.getElementById("scheduleForm"),
  schedulePhase: document.getElementById("schedulePhase"),
  scheduleTime: document.getElementById("scheduleTime"),
  scheduleTeamALabel: document.getElementById("scheduleTeamALabel"),
  scheduleTeamBLabel: document.getElementById("scheduleTeamBLabel"),
  scheduleTeamAId: document.getElementById("scheduleTeamAId"),
  scheduleTeamBId: document.getElementById("scheduleTeamBId"),
  scheduleTeamASelectWrap: document.getElementById("scheduleTeamASelectWrap"),
  scheduleTeamBSelectWrap: document.getElementById("scheduleTeamBSelectWrap"),
  scheduleGroupLabel: document.getElementById("scheduleGroupLabel"),
  scheduleList: document.getElementById("scheduleList"),
  loadScheduleTemplateBtn: document.getElementById("loadScheduleTemplateBtn"),
  sortScheduleBtn: document.getElementById("sortScheduleBtn"),
  generateBracketBtn: document.getElementById("generateBracketBtn"),
  bracketBoard: document.getElementById("bracketBoard"),
  playerRanking: document.getElementById("playerRanking"),
  teamRanking: document.getElementById("teamRanking"),
  penaltyDialog: document.getElementById("penaltyDialog"),
  penaltyDialogTitle: document.getElementById("penaltyDialogTitle"),
  teamChangeDialog: document.getElementById("teamChangeDialog"),
  teamChangeDialogTitle: document.getElementById("teamChangeDialogTitle"),
  teamChangeSelect: document.getElementById("teamChangeSelect"),
  teamLineupDialog: document.getElementById("teamLineupDialog"),
  teamLineupTitle: document.getElementById("teamLineupTitle"),
  teamLineupList: document.getElementById("teamLineupList")
};

init().catch(() => alert("Falha ao iniciar admin"));

async function init() {
  bindEvents();
  registerServiceWorker();
  if (sessionStorage.getItem(ADMIN_SESSION_KEY) === "1") {
    unlockAdmin();
    await bootstrap();
  } else {
    lockAdmin();
  }
}

async function bootstrap() {
  const [a, b] = await Promise.allSettled([apiJson("/api/state"), apiJson("/api/users")]);
  if (a.status === "fulfilled") assignState(a.value.tournament || {});
  if (b.status === "fulfilled") registeredUsers = Array.isArray(b.value.users) ? b.value.users : [];
  renderAll();
  loaded = true;
}

function bindEvents() {
  els.adminLoginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = String(els.adminUsername?.value || "").trim();
    const p = String(els.adminPassword?.value || "");
    if (u !== ADMIN_FIXED_USER || p !== ADMIN_FIXED_PASSWORD) {
      if (els.adminLoginError) els.adminLoginError.textContent = "Usuario ou senha invalidos.";
      return;
    }
    sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
    if (els.adminLoginError) els.adminLoginError.textContent = "";
    unlockAdmin();
    await bootstrap();
  });

  els.tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab || "jogadores")));
  els.playerSearch?.addEventListener("input", renderPlayers);

  els.teamForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!loaded) return;
    const name = String(els.teamName?.value || "").trim();
    if (!name) return;
    const logo = els.teamLogo?.files?.[0] ? await fileToDataURL(els.teamLogo.files[0]) : "";
    state.teams.push({ id: uid(), name, color: String(els.teamColor?.value || "#0f766e"), logoDataUrl: logo, stats: defaultTeamStats(), createdAt: Date.now() });
    els.teamForm.reset();
    if (els.teamColor) els.teamColor.value = "#0f766e";
    await persistAndRender();
  });

  els.playerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!loaded) return;
    const name = String(els.playerName?.value || "").trim();
    if (!name) return;
    const photo = els.playerPhoto?.files?.[0] ? await fileToDataURL(els.playerPhoto.files[0]) : "";
    state.players.push({ id: uid(), name, number: toNumOrNull(els.playerNumber?.value), position: String(els.playerPosition?.value || ""), teamId: String(els.playerTeamId?.value || ""), userId: String(els.playerUserId?.value || ""), photoDataUrl: photo, yellowCards: 0, redCards: 0, goals: 0, assists: 0, goalsPro: 0, goalsContra: 0, isCaptain: false, createdAt: Date.now() });
    els.playerForm.reset();
    await persistAndRender();
  });
  els.addGoalBtn?.addEventListener("click", () => {
    const id = String(els.goalPlayerSelect?.value || "");
    const p = state.players.find((x) => x.id === id);
    if (!p) return;
    pendingGoalEvents.push({ playerId: p.id, playerName: p.name });
    renderGoalEvents();
  });

  els.matchForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = String(els.matchTeamA?.value || "");
    const b = String(els.matchTeamB?.value || "");
    if (!a || !b || a === b) return alert("Selecione dois times diferentes.");
    const ga = Math.max(0, Number(els.matchGoalsA?.value || 0));
    const gb = Math.max(0, Number(els.matchGoalsB?.value || 0));
    const events = pendingGoalEvents.slice();
    state.matches.push({ id: uid(), teamAId: a, teamBId: b, goalsA: ga, goalsB: gb, stage: String(els.matchStage?.value || "Grupo"), date: String(els.matchDate?.value || ""), goalEvents: events, createdAt: Date.now() });
    events.forEach((ev) => {
      const p = state.players.find((x) => x.id === ev.playerId);
      if (p) {
        p.goals = Math.max(0, Number(p.goals || 0) + 1);
        p.goalsPro = Math.max(0, Number(p.goalsPro || 0) + 1);
      }
    });
    rebuildTeamStatsFromMatches();
    pendingGoalEvents = [];
    els.matchForm.reset();
    if (els.matchGoalsA) els.matchGoalsA.value = "0";
    if (els.matchGoalsB) els.matchGoalsB.value = "0";
    await persistAndRender();
  });

  els.eventSettingsForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    state.settings.eventStartAt = String(els.eventStartAt?.value || "");
    if (els.eventSettingsMessage) els.eventSettingsMessage.textContent = state.settings.eventStartAt ? "Horario salvo." : "Horario removido.";
    await persistAndRender();
  });

  els.pushTestForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (els.pushTestMessage) els.pushTestMessage.textContent = "Enviando notificacao...";
    try {
      const payload = { title: String(els.pushTitle?.value || "Resenha dos Ferreira"), body: String(els.pushBody?.value || "Nova atualizacao da resenha."), url: String(els.pushUrl?.value || "/player/home") };
      const uidValue = String(els.pushUserId?.value || "");
      if (uidValue) payload.userId = uidValue;
      const r = await apiJson("/api/push/test", { method: "POST", body: JSON.stringify(payload), timeoutMs: 45000 });
      if (els.pushTestMessage) els.pushTestMessage.textContent = `Notificacao enviada. Inscricoes: ${Number(r.total || 0)}. Entregues: ${Number(r.sent || 0)}.`;
    } catch (err) {
      if (els.pushTestMessage) els.pushTestMessage.textContent = `Falha ao enviar push: ${err.message || "erro"}`;
    }
  });

  els.schedulePhase?.addEventListener("input", syncScheduleMode);
  els.scheduleForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const phase = String(els.schedulePhase?.value || "").trim();
    const time = String(els.scheduleTime?.value || "").trim();
    let teamAId = "", teamBId = "";
    let teamALabel = String(els.scheduleTeamALabel?.value || "").trim();
    let teamBLabel = String(els.scheduleTeamBLabel?.value || "").trim();
    if (isGroupPhase(phase)) {
      teamAId = String(els.scheduleTeamAId?.value || "");
      teamBId = String(els.scheduleTeamBId?.value || "");
      if (!teamAId || !teamBId || teamAId === teamBId) return alert("Selecione dois times diferentes.");
      teamALabel = findTeam(teamAId)?.name || "";
      teamBLabel = findTeam(teamBId)?.name || "";
    }
    if (!phase || !time || !teamALabel || !teamBLabel) return;
    state.gameSchedule.push({ id: uid(), phase, time, teamALabel, teamBLabel, teamAId, teamBId, groupLabel: String(els.scheduleGroupLabel?.value || ""), createdAt: Date.now() });
    els.scheduleForm.reset();
    syncScheduleMode();
    await persistAndRender();
  });

  els.sortScheduleBtn?.addEventListener("click", async () => {
    state.gameSchedule = state.gameSchedule.slice().sort((a, b) => phasePriority(a.phase) - phasePriority(b.phase) || String(a.time || "").localeCompare(String(b.time || "")));
    await persistAndRender();
  });

  els.loadScheduleTemplateBtn?.addEventListener("click", async () => {
    if (!confirm("Carregar agenda padrao e substituir a atual?")) return;
    const rows = [["FASE DE GRUPO (2x7 minutos)", "09:00", "Time A", "Time B", "Grupo A"], ["FASE DE GRUPO (2x7 minutos)", "09:15", "Time D", "Time E", "Grupo B"], ["FASE DE GRUPO (2x7 minutos)", "09:30", "Time A", "Time C", "Grupo A"], ["FASE DE GRUPO (2x7 minutos)", "09:45", "Time D", "Time F", "Grupo B"], ["FASE DE GRUPO (2x7 minutos)", "10:00", "Time B", "Time C", "Grupo A"], ["FASE DE GRUPO (2x7 minutos)", "10:15", "Time E", "Time F", "Grupo B"], ["SEMIFINAIS (2x7 minutos)", "10:45", "1º Grupo A", "2º Grupo B", ""], ["SEMIFINAIS (2x7 minutos)", "11:00", "1º Grupo B", "2º Grupo A", ""], ["FINAL (2x7 minutos)", "11:30", "Vencedor SF1", "Vencedor SF2", ""]];
    state.gameSchedule = rows.map((r, i) => ({ id: uid(), phase: r[0], time: r[1], teamALabel: r[2], teamBLabel: r[3], teamAId: "", teamBId: "", groupLabel: r[4], createdAt: Date.now() + i }));
    await persistAndRender();
  });

  els.teamsList?.addEventListener("click", async (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!btn) return;
    if (btn.dataset.teamDelete) return deleteTeam(btn.dataset.teamDelete);
    if (btn.dataset.teamSave) return saveTeam(btn.dataset.teamSave);
    if (btn.dataset.teamLogoRemove) return removeTeamLogo(btn.dataset.teamLogoRemove);
    if (btn.dataset.teamStatsSave) return saveTeamStats(btn.dataset.teamStatsSave);
    if (btn.dataset.teamStatsReset) return resetTeamStats(btn.dataset.teamStatsReset);
  });

  els.teamsList?.addEventListener("change", async (e) => {
    const input = e.target;
    if (!input || !input.matches || !input.matches("[data-team-logo-file]")) return;
    const team = findTeam(String(input.getAttribute("data-team-logo-file") || ""));
    const file = input.files && input.files[0];
    if (!team || !file) return;
    team.logoDataUrl = await fileToDataURL(file);
    await persistAndRender();
  });

  els.playersList?.addEventListener("click", async (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("button, [role='button']") : null;
    if (!btn) return;
    if (btn.dataset.playerDelete) return deletePlayer(btn.dataset.playerDelete);
    if (btn.dataset.playerPenalty) return openPenalty(btn.dataset.playerPenalty);
    if (btn.dataset.playerTeamChange) return openTeamChange(btn.dataset.playerTeamChange);
    if (btn.dataset.playerCaptain) return toggleCaptain(btn.dataset.playerCaptain);
    if (btn.dataset.playerAssist) return addPlayerStat(btn.dataset.playerAssist, "assists", 1);
    if (btn.dataset.playerGp) return addPlayerStat(btn.dataset.playerGp, "goalsPro", 1);
    if (btn.dataset.playerGc) return addPlayerStat(btn.dataset.playerGc, "goalsContra", 1);
    if (btn.dataset.playerResetCards) return resetCards(btn.dataset.playerResetCards);
    if (btn.dataset.playerResetAgs) return resetPlayerStats(btn.dataset.playerResetAgs);
  });
  els.matchesList?.addEventListener("click", async (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!btn || !btn.dataset.matchDelete) return;
    await deleteMatch(btn.dataset.matchDelete);
  });

  els.scheduleList?.addEventListener("click", async (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!btn || !btn.dataset.scheduleDelete) return;
    state.gameSchedule = state.gameSchedule.filter((g) => String(g.id) !== String(btn.dataset.scheduleDelete));
    await persistAndRender();
  });

  document.addEventListener("click", (e) => {
    const node = e.target && e.target.closest ? e.target.closest("[data-team-open]") : null;
    if (!node) return;
    openTeamLineup(node.dataset.teamOpen || "", node.dataset.teamName || "");
  });

  els.penaltyDialog?.addEventListener("close", async () => {
    const action = String(els.penaltyDialog?.returnValue || "");
    const p = state.players.find((x) => x.id === selectedPenaltyPlayerId);
    selectedPenaltyPlayerId = null;
    if (!p) return;
    if (action === "yellow") p.yellowCards = Math.max(0, Number(p.yellowCards || 0) + 1);
    if (action === "red") p.redCards = Math.max(0, Number(p.redCards || 0) + 1);
    if (action === "yellow" || action === "red") await persistAndRender();
  });

  els.teamChangeDialog?.addEventListener("close", async () => {
    if (String(els.teamChangeDialog?.returnValue || "") !== "save") return;
    const p = state.players.find((x) => x.id === selectedTeamChangePlayerId);
    selectedTeamChangePlayerId = null;
    if (!p) return;
    p.teamId = String(els.teamChangeSelect?.value || "");
    await persistAndRender();
  });

  els.resetStatsBtn?.addEventListener("click", async () => {
    if (!confirm("Zerar estatisticas de jogadores, times e tabela e apagar jogos recentes?")) return;
    state.players = state.players.map((p) => ({ ...p, yellowCards: 0, redCards: 0, goals: 0, assists: 0, goalsPro: 0, goalsContra: 0 }));
    state.teams = state.teams.map((t) => ({ ...t, stats: defaultTeamStats() }));
    state.matches = [];
    state.recentGames = [];
    state.liveGame = null;
    pendingGoalEvents = [];
    await persistAndRender();
  });

  els.resetDataBtn?.addEventListener("click", async () => {
    if (!confirm("Apagar todos os dados do campeonato?")) return;
    assignState({});
    pendingGoalEvents = [];
    await persistAndRender();
  });
}

function renderAll() {
  renderTeamOptions();
  renderUsersOptions();
  renderGoalOptions();
  renderGoalEvents();
  renderPlayers();
  renderTeams();
  renderMatches();
  renderSchedule();
  renderBracket();
  renderRankings();
  syncScheduleMode();
  if (els.eventStartAt) els.eventStartAt.value = String(state.settings?.eventStartAt || "");
}

function renderPlayers() {
  if (!els.playersList) return;
  const term = String(els.playerSearch?.value || "").trim().toLowerCase();
  const players = state.players.filter((p) => String(p.name || "").toLowerCase().includes(term)).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
  const topScorerId = getTopScorerId();
  els.playersList.innerHTML = players.length ? players.map((p) => {
    const team = findTeam(p.teamId);
    const photo = p.photoDataUrl ? `<img src="${esc(p.photoDataUrl)}" alt="${esc(p.name)}">` : `<div class="player-photo-placeholder">${esc(initials(p.name))}</div>`;
    return `<article class="player-card"><div class="player-photo-wrap" data-player-penalty="${esc(p.id)}" role="button">${photo}<div class="penalty-badges">${p.yellowCards ? `<span class="penalty-chip yellow">CA ${Number(p.yellowCards)}</span>` : ""}${p.redCards ? `<span class="penalty-chip red">CV ${Number(p.redCards)}</span>` : ""}</div><div class="player-stat-badges"><span class="mini-chip">A ${Number(p.assists || 0)}</span><span class="mini-chip">GP ${Number(p.goalsPro || 0)}</span><span class="mini-chip">GC ${Number(p.goalsContra || 0)}</span>${p.isCaptain ? '<span class="mini-chip captain-chip">C</span>' : ""}${topScorerId === p.id ? '<span class="mini-chip topscorer-chip">⚽</span>' : ""}</div></div><div class="player-meta"><div class="player-name" role="button" data-player-team-change="${esc(p.id)}">${esc(p.name)}</div><div class="player-sub">${esc(team ? team.name : "Sem time")} · #${p.number == null ? "-" : Number(p.number)} · ${esc(p.position || "-")}</div><div class="mini-actions"><button class="ghost" type="button" data-player-captain="${esc(p.id)}">${p.isCaptain ? "Remover C" : "Capitao"}</button><button class="ghost" type="button" data-player-assist="${esc(p.id)}">+A</button><button class="ghost" type="button" data-player-gp="${esc(p.id)}">+GP</button><button class="ghost" type="button" data-player-gc="${esc(p.id)}">+GC</button><button class="ghost" type="button" data-player-reset-ags="${esc(p.id)}">Zerar A/GP/GC</button><button class="ghost" type="button" data-player-reset-cards="${esc(p.id)}">Zerar cartoes</button><button class="danger" type="button" data-player-delete="${esc(p.id)}">Excluir</button></div></div></article>`;
  }).join("") : '<p class="muted">Nenhum jogador cadastrado.</p>';
}

function renderTeams() {
  if (!els.teamsList) return;
  const teams = [...state.teams].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
  els.teamsList.innerHTML = teams.length ? teams.map((team) => {
    const s = teamStats(team);
    const count = state.players.filter((p) => String(p.teamId || "") === String(team.id)).length;
    return `<article class="team-card"><div class="team-card-top"><h3><span class="team-pill">${teamIdentityHtml(team)}</span></h3><button class="danger" type="button" data-team-delete="${esc(team.id)}">Excluir</button></div><div class="team-edit-grid"><label>Nome do time<input type="text" value="${esc(team.name || "")}" data-team-name-input="${esc(team.id)}"></label><label>Cor<input type="color" value="${esc(team.color || "#0f766e")}" data-team-color-input="${esc(team.id)}"></label><label class="full">Logo (opcional)<input type="file" accept="image/*" data-team-logo-file="${esc(team.id)}"></label></div><p class="muted">${count} jogador(es)</p><div class="team-stats-grid">${teamStatInput(team.id, "points", "P", s.points)}${teamStatInput(team.id, "games", "J", s.games)}${teamStatInput(team.id, "wins", "V", s.wins)}${teamStatInput(team.id, "draws", "E", s.draws)}${teamStatInput(team.id, "losses", "D", s.losses)}${teamStatInput(team.id, "goalsPro", "GP", s.goalsPro)}${teamStatInput(team.id, "goalsContra", "GC", s.goalsContra)}${teamStatInput(team.id, "goalDiff", "SG", s.goalDiff)}</div><div class="mini-actions"><button class="ghost" type="button" data-team-save="${esc(team.id)}">Salvar time</button><button class="ghost" type="button" data-team-logo-remove="${esc(team.id)}">Remover logo</button><button class="ghost" type="button" data-team-stats-save="${esc(team.id)}">Salvar tabela</button><button class="ghost" type="button" data-team-stats-reset="${esc(team.id)}">Zerar tabela</button></div></article>`;
  }).join("") : '<p class="muted">Nenhum time cadastrado.</p>';
}

function renderMatches() {
  if (!els.matchesList) return;
  const matches = [...state.matches].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
  els.matchesList.innerHTML = matches.length ? matches.map((m) => `<article class="match-card"><div class="match-row"><strong>${esc(m.stage || "Jogo")}</strong><button class="danger" type="button" data-match-delete="${esc(m.id)}">Excluir</button></div><div class="match-row"><span class="team-inline">${teamInlineHtml(findTeam(m.teamAId), "Time A")}</span><strong>${Number(m.goalsA || 0)} x ${Number(m.goalsB || 0)}</strong><span class="team-inline">${teamInlineHtml(findTeam(m.teamBId), "Time B")}</span></div><small class="muted">${m.date ? formatDate(m.date) : "Sem data"}</small></article>`).join("") : '<p class="muted">Nenhum jogo cadastrado.</p>';
}
function renderSchedule() {
  if (!els.scheduleList) return;
  const rows = [...state.gameSchedule].sort((a, b) => phasePriority(a.phase) - phasePriority(b.phase) || String(a.time || "").localeCompare(String(b.time || "")));
  let prev = "";
  els.scheduleList.innerHTML = rows.length ? rows.map((r) => {
    const phase = String(r.phase || "");
    const head = phase !== prev ? `<div class="schedule-phase">${esc(phase)}</div>` : "";
    prev = phase;
    return `${head}<article class="schedule-card"><div class="match-row"><strong>${esc(r.time || "--:--")}</strong><button class="danger" type="button" data-schedule-delete="${esc(r.id)}">Excluir</button></div><div class="match-row"><span>${esc(r.teamALabel || "-")}</span><strong>X</strong><span>${esc(r.teamBLabel || "-")}</span></div>${r.groupLabel ? `<small class="muted">${esc(r.groupLabel)}</small>` : ""}</article>`;
  }).join("") : '<p class="muted">Nenhum jogo na agenda.</p>';
}

function renderBracket() {
  if (!els.bracketBoard) return;
  const rows = [...state.matches].filter((m) => ["Quartas", "Semifinal", "Final"].includes(String(m.stage || ""))).sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage));
  const grouped = { Quartas: [], Semifinal: [], Final: [] };
  rows.forEach((m) => grouped[m.stage].push(m));
  els.bracketBoard.innerHTML = ["Quartas", "Semifinal", "Final"].map((stage) => grouped[stage].length ? `<section class="bracket-stage"><h3>${stage}</h3><div class="matches-list">${grouped[stage].map((m) => `<div class="bracket-match"><div class="bracket-team"><span>${esc(findTeam(m.teamAId)?.name || "Time A")}</span><strong>${Number(m.goalsA || 0)}</strong></div><div class="bracket-team"><span>${esc(findTeam(m.teamBId)?.name || "Time B")}</span><strong>${Number(m.goalsB || 0)}</strong></div></div>`).join("")}</div></section>` : "").join("") || '<p class="muted">Sem chaveamento ainda.</p>';
}

function renderRankings() {
  if (els.playerRanking) {
    const players = [...state.players].map((p) => ({ p, points: Number(p.goals || 0) * 3 - Number(p.yellowCards || 0) - Number(p.redCards || 0) * 3 })).sort((a, b) => b.points - a.points || Number(b.p.goals || 0) - Number(a.p.goals || 0));
    els.playerRanking.innerHTML = players.length ? `<table><thead><tr><th>#</th><th>Jogador</th><th>Time</th><th>Gols</th><th>🟨</th><th>🟥</th><th>Pontos</th></tr></thead><tbody>${players.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.p.name || "Jogador")}</td><td>${esc(findTeam(r.p.teamId)?.name || "Sem time")}</td><td>${Number(r.p.goals || 0)}</td><td>${Number(r.p.yellowCards || 0)}</td><td>${Number(r.p.redCards || 0)}</td><td>${r.points}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">Sem jogadores cadastrados.</p>';
  }
  if (els.teamRanking) {
    const teams = [...state.teams].map((t) => ({ t, s: teamStats(t) })).sort((a, b) => Number(b.s.points || 0) - Number(a.s.points || 0) || Number(b.s.goalDiff || 0) - Number(a.s.goalDiff || 0) || Number(b.s.goalsPro || 0) - Number(a.s.goalsPro || 0));
    els.teamRanking.innerHTML = teams.length ? `<table><thead><tr><th>#</th><th>Time</th><th>P</th><th>J</th><th>V</th><th>E</th><th>D</th><th>GP</th><th>GC</th><th>SG</th></tr></thead><tbody>${teams.map((r, i) => `<tr><td>${i + 1}</td><td><span class="team-pill">${teamIdentityHtml(r.t)}</span></td><td>${Number(r.s.points || 0)}</td><td>${Number(r.s.games || 0)}</td><td>${Number(r.s.wins || 0)}</td><td>${Number(r.s.draws || 0)}</td><td>${Number(r.s.losses || 0)}</td><td>${Number(r.s.goalsPro || 0)}</td><td>${Number(r.s.goalsContra || 0)}</td><td>${Number(r.s.goalDiff || 0)}</td></tr>`).join("")}</tbody></table>` : '<p class="muted">Sem times para tabela.</p>';
  }
}

function renderTeamOptions() { const options = [...state.teams].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")).map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join(""); const keep = { pt: String(els.playerTeamId?.value || ""), a: String(els.matchTeamA?.value || ""), b: String(els.matchTeamB?.value || ""), sa: String(els.scheduleTeamAId?.value || ""), sb: String(els.scheduleTeamBId?.value || "") }; if (els.playerTeamId) els.playerTeamId.innerHTML = `<option value="">Sem time</option>${options}`; if (els.matchTeamA) els.matchTeamA.innerHTML = `<option value="">Selecione</option>${options}`; if (els.matchTeamB) els.matchTeamB.innerHTML = `<option value="">Selecione</option>${options}`; if (els.scheduleTeamAId) els.scheduleTeamAId.innerHTML = `<option value="">Selecione</option>${options}`; if (els.scheduleTeamBId) els.scheduleTeamBId.innerHTML = `<option value="">Selecione</option>${options}`; if (els.playerTeamId && keep.pt) els.playerTeamId.value = keep.pt; if (els.matchTeamA && keep.a) els.matchTeamA.value = keep.a; if (els.matchTeamB && keep.b) els.matchTeamB.value = keep.b; if (els.scheduleTeamAId && keep.sa) els.scheduleTeamAId.value = keep.sa; if (els.scheduleTeamBId && keep.sb) els.scheduleTeamBId.value = keep.sb; }
function renderUsersOptions() { const options = [...registeredUsers].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")).map((u) => `<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.email)})</option>`).join(""); const k1 = String(els.playerUserId?.value || ""); const k2 = String(els.pushUserId?.value || ""); if (els.playerUserId) els.playerUserId.innerHTML = `<option value="">Sem vinculo (jogador ainda nao se cadastrou)</option>${options}`; if (els.pushUserId) els.pushUserId.innerHTML = `<option value="">Todos os jogadores com notificacao ativa</option>${options}`; if (els.playerUserId && k1) els.playerUserId.value = k1; if (els.pushUserId && k2) els.pushUserId.value = k2; }
function renderGoalOptions() { const keep = String(els.goalPlayerSelect?.value || ""); const options = [...state.players].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")).map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(findTeam(p.teamId)?.name || "Sem time")})</option>`).join(""); if (els.goalPlayerSelect) { els.goalPlayerSelect.innerHTML = `<option value="">Selecione</option>${options}`; if (keep) els.goalPlayerSelect.value = keep; } }
function renderGoalEvents() { if (!els.goalEvents) return; els.goalEvents.innerHTML = pendingGoalEvents.length ? pendingGoalEvents.map((g, i) => `<div class="goal-event"><div><strong>${esc(g.playerName)}</strong><small>Gol para este jogo</small></div><button class="ghost" type="button" data-goal-remove="${i}">Remover</button></div>`).join("") : '<p class="muted">Nenhum gol de jogador adicionado.</p>'; els.goalEvents.querySelectorAll("[data-goal-remove]").forEach((b) => b.addEventListener("click", () => { pendingGoalEvents.splice(Number(b.dataset.goalRemove || -1), 1); renderGoalEvents(); })); }
function syncScheduleMode() { const group = isGroupPhase(els.schedulePhase?.value || ""); if (els.scheduleTeamASelectWrap) els.scheduleTeamASelectWrap.hidden = !group; if (els.scheduleTeamBSelectWrap) els.scheduleTeamBSelectWrap.hidden = !group; if (els.scheduleTeamALabel) { els.scheduleTeamALabel.disabled = group; if (group) els.scheduleTeamALabel.value = ""; } if (els.scheduleTeamBLabel) { els.scheduleTeamBLabel.disabled = group; if (group) els.scheduleTeamBLabel.value = ""; } }

function lockAdmin() { document.body.classList.add("admin-locked"); if (els.adminLoginGate) { els.adminLoginGate.hidden = false; els.adminLoginGate.style.display = "grid"; } }
function unlockAdmin() { document.body.classList.remove("admin-locked"); if (els.adminLoginGate) { els.adminLoginGate.hidden = true; els.adminLoginGate.style.display = "none"; } }
function switchTab(name) { els.tabs.forEach((b) => b.classList.toggle("is-active", b.dataset.tab === name)); els.panels.forEach((p) => { const active = p.id === `tab-${name}`; p.hidden = !active; p.classList.toggle("is-active", active); }); }
async function persistAndRender() { renderAll(); await saveState(); }
async function saveState() {
  if (saving) { saveAgain = true; return; }
  saving = true;
  try { await apiJson("/api/state", { method: "PUT", body: JSON.stringify({ tournament: state }) }); }
  finally { saving = false; if (saveAgain) { saveAgain = false; await saveState(); } }
}
function assignState(src) { state.teams = Array.isArray(src.teams) ? src.teams : []; state.players = Array.isArray(src.players) ? src.players : []; state.matches = Array.isArray(src.matches) ? src.matches : []; state.gameSchedule = Array.isArray(src.gameSchedule) ? src.gameSchedule : []; state.bracket = Array.isArray(src.bracket) ? src.bracket : []; state.liveGame = src.liveGame && typeof src.liveGame === "object" ? src.liveGame : null; state.recentGames = Array.isArray(src.recentGames) ? src.recentGames : []; state.settings = { eventStartAt: String(src?.settings?.eventStartAt || "") }; }

function defaultTeamStats() { return { points: 0, games: 0, wins: 0, draws: 0, losses: 0, goalsPro: 0, goalsContra: 0, goalDiff: 0 }; }
function teamStats(team) { const s = team?.stats || {}; return { points: Number(s.points || 0), games: Number(s.games || 0), wins: Number(s.wins || 0), draws: Number(s.draws || 0), losses: Number(s.losses || 0), goalsPro: Number(s.goalsPro || 0), goalsContra: Number(s.goalsContra || 0), goalDiff: Number(s.goalDiff || 0) }; }
function findTeam(id) { return state.teams.find((t) => String(t.id) === String(id)); }
function isGroupPhase(phase) { return String(phase || "").toLowerCase().includes("grupo"); }
function phasePriority(phase) { const p = String(phase || "").toLowerCase(); if (p.includes("grupo")) return 1; if (p.includes("semi")) return 2; if (p.includes("final")) return 3; return 9; }
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5); }
function toNumOrNull(v) { if (String(v || "").trim() === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function initials(name) { return String(name || "J").split(/\s+/).slice(0, 2).map((p) => (p[0] || "").toUpperCase()).join("") || "J"; }
function stageOrder(stage) { return { Quartas: 1, Semifinal: 2, Final: 3 }[String(stage || "")] || 99; }
function formatDate(v) { const p = String(v || "").split("-"); return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : String(v || ""); }
function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
function cssEscape(v) { return String(v == null ? "" : v).replace(/[\"\\]/g, "\\$&"); }

function getTopScorerId() { let best = null; for (const p of state.players) { const g = Math.max(0, Number(p.goals || 0)); if (g <= 0) continue; if (!best || g > best.g || (g === best.g && String(p.name || "").localeCompare(String(best.n || ""), "pt-BR") < 0)) best = { id: p.id, g, n: p.name }; } return best ? String(best.id) : ""; }
function teamStatInput(id, key, label, value) { return `<label class="team-stat-field">${label}<input type="number" min="0" value="${Number(value || 0)}" data-team-stat-input="${esc(id)}:${key}"></label>`; }

function teamIdentityHtml(team) { const n = esc(team?.name || "Time"); if (team?.logoDataUrl) return `<button type="button" class="team-open-btn" data-team-open="${esc(team.id)}" data-team-name="${n}"><span class="team-logo"><img src="${esc(team.logoDataUrl)}" alt="${n}"></span><span>${n}</span></button>`; return `<button type="button" class="team-open-btn" data-team-open="${esc(team?.id || "")}" data-team-name="${n}"><span class="team-dot" style="background:${esc(team?.color || "#0f766e")}"></span><span>${n}</span></button>`; }
function teamInlineHtml(team, fallback) { const n = esc(team?.name || fallback || "Time"); if (team?.logoDataUrl) return `<button type="button" class="team-open-btn" data-team-open="${esc(team.id)}" data-team-name="${n}"><span class="team-logo tiny"><img src="${esc(team.logoDataUrl)}" alt="${n}"></span><span>${n}</span></button>`; return `<button type="button" class="team-open-btn" data-team-open="${esc(team?.id || "")}" data-team-name="${n}"><span class="team-dot small" style="background:${esc(team?.color || "#0f766e")}"></span><span>${n}</span></button>`; }

function rebuildTeamStatsFromMatches() { const map = new Map(); state.teams.forEach((t) => map.set(String(t.id), defaultTeamStats())); state.matches.forEach((m) => { const a = map.get(String(m.teamAId || "")); const b = map.get(String(m.teamBId || "")); if (!a || !b) return; const ga = Number(m.goalsA || 0), gb = Number(m.goalsB || 0); a.games += 1; b.games += 1; a.goalsPro += ga; a.goalsContra += gb; b.goalsPro += gb; b.goalsContra += ga; if (ga > gb) { a.wins += 1; a.points += 3; b.losses += 1; } else if (gb > ga) { b.wins += 1; b.points += 3; a.losses += 1; } else { a.draws += 1; b.draws += 1; a.points += 1; b.points += 1; } }); state.teams = state.teams.map((t) => { const s = map.get(String(t.id)) || defaultTeamStats(); s.goalDiff = Number(s.goalsPro) - Number(s.goalsContra); return { ...t, stats: s }; }); }

async function saveTeam(id) { const t = findTeam(id); if (!t) return; const n = document.querySelector(`[data-team-name-input="${cssEscape(t.id)}"]`); const c = document.querySelector(`[data-team-color-input="${cssEscape(t.id)}"]`); const name = String(n?.value || "").trim(); if (!name) return alert("Nome do time e obrigatorio."); t.name = name; t.color = String(c?.value || "#0f766e"); await persistAndRender(); }
async function removeTeamLogo(id) { const t = findTeam(id); if (!t) return; t.logoDataUrl = ""; await persistAndRender(); }
async function saveTeamStats(id) { const t = findTeam(id); if (!t) return; const s = defaultTeamStats(); ["points", "games", "wins", "draws", "losses", "goalsPro", "goalsContra", "goalDiff"].forEach((k) => { const i = document.querySelector(`[data-team-stat-input="${cssEscape(t.id)}:${k}"]`); s[k] = Math.max(0, Number(i?.value || 0)); }); s.goalDiff = Number(s.goalsPro) - Number(s.goalsContra); t.stats = s; await persistAndRender(); }
async function resetTeamStats(id) { const t = findTeam(id); if (!t) return; t.stats = defaultTeamStats(); await persistAndRender(); }
async function deleteTeam(id) { const t = findTeam(id); if (!t) return; if (state.matches.some((m) => String(m.teamAId) === String(id) || String(m.teamBId) === String(id))) return alert("Esse time ja tem jogos cadastrados. Exclua os jogos antes."); if (!confirm(`Excluir time ${t.name}?`)) return; state.teams = state.teams.filter((x) => String(x.id) !== String(id)); state.players = state.players.map((p) => String(p.teamId || "") === String(id) ? { ...p, teamId: "" } : p); await persistAndRender(); }
async function deletePlayer(id) { const p = state.players.find((x) => x.id === id); if (!p) return; if (!confirm(`Excluir jogador ${p.name}?`)) return; state.players = state.players.filter((x) => x.id !== id); state.matches = state.matches.map((m) => ({ ...m, goalEvents: Array.isArray(m.goalEvents) ? m.goalEvents.filter((g) => String(g.playerId) !== String(id)) : [] })); await persistAndRender(); }
async function deleteMatch(id) { const m = state.matches.find((x) => x.id === id); if (!m) return; if (!confirm("Excluir jogo?")) return; (m.goalEvents || []).forEach((g) => { const p = state.players.find((x) => x.id === g.playerId); if (p) { p.goals = Math.max(0, Number(p.goals || 0) - 1); p.goalsPro = Math.max(0, Number(p.goalsPro || 0) - 1); } }); state.matches = state.matches.filter((x) => x.id !== id); state.recentGames = state.recentGames.filter((g) => String(g?.linkedMatchId || g?.matchId || "") !== String(id)); rebuildTeamStatsFromMatches(); await persistAndRender(); }
function openPenalty(id) { const p = state.players.find((x) => x.id === id); if (!p || !els.penaltyDialog) return; selectedPenaltyPlayerId = id; if (els.penaltyDialogTitle) els.penaltyDialogTitle.textContent = `Penalidade - ${p.name}`; els.penaltyDialog.showModal?.(); }
function openTeamChange(id) { const p = state.players.find((x) => x.id === id); if (!p || !els.teamChangeDialog || !els.teamChangeSelect) return; selectedTeamChangePlayerId = id; if (els.teamChangeDialogTitle) els.teamChangeDialogTitle.textContent = `Trocar time - ${p.name}`; els.teamChangeSelect.innerHTML = `<option value="">Sem time</option>${[...state.teams].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")).map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}`; els.teamChangeSelect.value = String(p.teamId || ""); els.teamChangeDialog.showModal?.(); }
async function toggleCaptain(id) { const p = state.players.find((x) => x.id === id); if (!p) return; p.isCaptain = !p.isCaptain; await persistAndRender(); }
async function addPlayerStat(id, field, delta) { const p = state.players.find((x) => x.id === id); if (!p) return; const d = Number(delta || 0); if (!d) return; if (field === "assists") p.assists = Math.max(0, Number(p.assists || 0) + d); if (field === "goalsPro") { p.goalsPro = Math.max(0, Number(p.goalsPro || 0) + d); p.goals = Math.max(0, Number(p.goals || 0) + d); } if (field === "goalsContra") p.goalsContra = Math.max(0, Number(p.goalsContra || 0) + d); await persistAndRender(); }
async function resetCards(id) { const p = state.players.find((x) => x.id === id); if (!p) return; p.yellowCards = 0; p.redCards = 0; await persistAndRender(); }
async function resetPlayerStats(id) { const p = state.players.find((x) => x.id === id); if (!p) return; if (!confirm(`Zerar todos os dados do jogador ${p.name}?`)) return; p.goals = 0; p.assists = 0; p.goalsPro = 0; p.goalsContra = 0; p.yellowCards = 0; p.redCards = 0; state.matches = state.matches.map((m) => ({ ...m, goalEvents: Array.isArray(m.goalEvents) ? m.goalEvents.filter((g) => String(g.playerId) !== String(id)) : [] })); await persistAndRender(); }

function openTeamLineup(teamId, teamName) { const t = findTeam(teamId) || state.teams.find((x) => String(x.name || "").trim().toLowerCase() === String(teamName || "").trim().toLowerCase()) || null; const title = t ? String(t.name || "Time") : String(teamName || "Time"); const players = t ? state.players.filter((p) => String(p.teamId || "") === String(t.id || "")).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")) : []; if (els.teamLineupTitle) els.teamLineupTitle.textContent = `Escalacao - ${title}`; if (els.teamLineupList) els.teamLineupList.innerHTML = players.length ? players.map((p) => `<div class="lineup-item"><div class="lineup-left">${p.photoDataUrl ? `<span class="lineup-avatar"><img src="${esc(p.photoDataUrl)}" alt="${esc(p.name)}"></span>` : `<span class="lineup-avatar">${esc(initials(p.name))}</span>`}<div><div class="lineup-name">${esc(p.name)} ${p.number == null ? "" : `#${Number(p.number)}`}</div><div class="lineup-meta">${esc(p.position || "-")}</div></div></div><div class="lineup-badges">${p.isCaptain ? "<span>C</span>" : ""}<span>A ${Number(p.assists || 0)}</span><span>GP ${Number(p.goalsPro || 0)}</span><span>GC ${Number(p.goalsContra || 0)}</span><span>CA ${Number(p.yellowCards || 0)}</span><span>CV ${Number(p.redCards || 0)}</span></div></div>`).join("") : '<p class="muted">Nenhum jogador vinculado a esse time.</p>'; els.teamLineupDialog?.showModal?.(); }

async function apiJson(url, options = {}) { const timeoutMs = Number(options.timeoutMs || 0); const controller = timeoutMs > 0 && typeof AbortController !== "undefined" ? new AbortController() : null; let timer = null; if (controller) timer = setTimeout(() => controller.abort("timeout"), timeoutMs); try { const res = await fetch(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options, signal: controller ? controller.signal : options.signal }); const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || `Erro ${res.status}`); return data; } finally { if (timer) clearTimeout(timer); } }
function fileToDataURL(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = reject; reader.readAsDataURL(file); }); }
function registerServiceWorker() { if (!("serviceWorker" in navigator)) return; window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {})); }
