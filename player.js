const TOKEN_KEY = 'resenha-player-token';

const els = {
  authScreen: document.getElementById('authScreen'),
  homeScreen: document.getElementById('homeScreen'),
  playerLoginView: document.getElementById('playerLoginView'),
  playerRegisterView: document.getElementById('playerRegisterView'),
  goToRegisterLink: document.getElementById('goToRegisterLink'),
  goToLoginLink: document.getElementById('goToLoginLink'),
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  authMessage: document.getElementById('authMessage'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  registerName: document.getElementById('registerName'),
  registerEmail: document.getElementById('registerEmail'),
  registerPassword: document.getElementById('registerPassword'),
  registerTeamSelect: document.getElementById('registerTeamSelect'),
  mainAvatar: document.getElementById('mainAvatar'),
  mainName: document.getElementById('mainName'),
  mainTeam: document.getElementById('mainTeam'),
  mainStats: document.getElementById('mainStats'),
  teammatesList: document.getElementById('teammatesList'),
  refreshHomeBtn: document.getElementById('refreshHomeBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  linkPendingBox: document.getElementById('linkPendingBox'),
  linkPendingText: document.getElementById('linkPendingText')
};

bindEvents();
bootstrap();

function bindEvents() {
  els.goToRegisterLink?.addEventListener('click', (e) => {
    e.preventDefault();
    switchAuthView('register');
  });

  els.goToLoginLink?.addEventListener('click', (e) => {
    e.preventDefault();
    switchAuthView('login');
  });

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: els.loginEmail.value, password: els.loginPassword.value })
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      await loadHome();
      switchAuthView('login');
    } catch (err) {
      setMessage(err.message || 'Falha no login');
    }
  });

  els.registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      const data = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: els.registerName.value,
          email: els.registerEmail.value,
          password: els.registerPassword.value
        })
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      await loadHome();
      switchAuthView('login');
    } catch (err) {
      setMessage(err.message || 'Falha no cadastro');
    }
  });

  els.refreshHomeBtn.addEventListener('click', () => {
    loadHome().catch((err) => setMessage(err.message || 'Falha ao atualizar'));
  });

  els.logoutBtn.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
  });
}

async function bootstrap() {
  const token = localStorage.getItem(TOKEN_KEY);
  await populateRegisterTeams();
  if (!token) return showAuth();
  try {
    await loadHome();
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
  }
}

function switchAuthView(view) {
  els.playerLoginView.hidden = view !== 'login';
  els.playerRegisterView.hidden = view !== 'register';
  setMessage('');
}

function showAuth() {
  els.authScreen.hidden = false;
  els.homeScreen.hidden = true;
  switchAuthView('login');
  populateRegisterTeams().catch(() => {});
}

async function populateRegisterTeams() {
  try {
    const data = await api('/api/state');
    const teams = Array.isArray(data?.tournament?.teams) ? data.tournament.teams : [];
    els.registerTeamSelect.innerHTML = '<option value="">Selecione</option>' +
      teams.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
        .map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  } catch {
    els.registerTeamSelect.innerHTML = '<option value="">Selecione</option>';
  }
}

async function loadHome() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error('Sessao expirada');
  const data = await api('/api/player/home', { headers: { Authorization: `Bearer ${token}` } });

  els.authScreen.hidden = true;
  els.homeScreen.hidden = false;

  if (!data.linked) {
    els.linkPendingBox.hidden = false;
    els.linkPendingText.textContent = data.message || 'Aguardando vinculo no painel.';
    renderMainProfile({
      name: data.user?.name || 'Jogador',
      teamName: 'Sem time',
      photoDataUrl: '',
      assists: 0,
      teamGoalsFor: 0,
      teamGoalsAgainst: 0,
      yellowCards: 0,
      redCards: 0
    });
    els.teammatesList.innerHTML = '<div class="empty-state">Nenhum companheiro para exibir.</div>';
    return;
  }

  els.linkPendingBox.hidden = true;
  renderMainProfile({
    name: data.player?.name || data.user?.name || 'Jogador',
    teamName: data.team?.name || 'Sem time',
    photoDataUrl: data.player?.photoDataUrl || '',
    assists: data.player?.assists || 0,
    teamGoalsFor: data.teamStats?.goalsFor || 0,
    teamGoalsAgainst: data.teamStats?.goalsAgainst || 0,
    yellowCards: data.player?.yellowCards || 0,
    redCards: data.player?.redCards || 0
  });

  const mates = Array.isArray(data.teammates) ? data.teammates : [];
  els.teammatesList.innerHTML = mates.length ? mates.map(renderMate).join('') : '<div class="empty-state">Nenhum companheiro para exibir.</div>';
}

function renderMainProfile(profile) {
  els.mainAvatar.src = profile.photoDataUrl || avatarFallback(profile.name, 96);
  els.mainName.textContent = profile.name;
  els.mainTeam.textContent = profile.teamName;
  els.mainStats.innerHTML = [
    statBox(profile.assists, 'A'),
    statBox(profile.teamGoalsFor, 'GP'),
    statBox(profile.teamGoalsAgainst, 'GC'),
    statBox(profile.yellowCards, 'CA'),
    statBox(profile.redCards, 'CV')
  ].join('');
}

function statBox(value, label) {
  return `<div class="stat"><div class="value">${Number(value) || 0}</div><div class="label">${label}</div></div>`;
}

function renderMate(m) {
  const photo = m.photoDataUrl || avatarFallback(m.name, 36);
  return `
    <div class="player-item">
      <div class="player-left">
        <img class="player-avatar" src="${esc(photo)}" alt="${esc(m.name)}">
        <div class="player-name">${esc(m.name)}${m.isMe ? ' (voce)' : ''}</div>
      </div>
      <div class="player-stats">
        <span>GP ${Number(m.goals || 0)}</span>
        <span>A ${Number(m.assists || 0)}</span>
        <span>CA ${Number(m.yellowCards || 0)}</span>
      </div>
    </div>`;
}

function avatarFallback(name, size) {
  const initials = String(name || 'J').split(/\s+/).slice(0, 2).map((p) => (p[0] || '').toUpperCase()).join('') || 'J';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" rx="${Math.floor(size/2)}" fill="#03180b"/><circle cx="${size/2}" cy="${size/2}" r="${size/2-2}" fill="none" stroke="#22c55e" stroke-width="2"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="${Math.floor(size*0.32)}" fill="#22c55e" font-weight="700">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na requisicao');
  return data;
}

function setMessage(text) {
  els.authMessage.textContent = text || '';
}

function esc(v) {
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
