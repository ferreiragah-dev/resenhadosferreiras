const TOKEN_KEY = 'resenha-player-token';

const els = {
  authScreen: document.getElementById('authScreen'),
  homeScreen: document.getElementById('homeScreen'),
  authTabs: [...document.querySelectorAll('.auth-tab')],
  authPanels: [...document.querySelectorAll('.auth-form')],
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  authMessage: document.getElementById('authMessage'),
  loginEmail: document.getElementById('loginEmail'),
  loginPassword: document.getElementById('loginPassword'),
  registerName: document.getElementById('registerName'),
  registerEmail: document.getElementById('registerEmail'),
  registerPassword: document.getElementById('registerPassword'),
  welcomeName: document.getElementById('welcomeName'),
  teamBox: document.getElementById('teamBox'),
  myCards: document.getElementById('myCards'),
  teammatesList: document.getElementById('teammatesList'),
  logoutBtn: document.getElementById('logoutBtn'),
  refreshHomeBtn: document.getElementById('refreshHomeBtn'),
  linkPendingBox: document.getElementById('linkPendingBox'),
  linkPendingText: document.getElementById('linkPendingText')
};

bindEvents();
bootstrap();

function bindEvents() {
  els.authTabs.forEach((btn) => btn.addEventListener('click', () => switchAuthTab(btn.dataset.authTab)));

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
    } catch (err) {
      setMessage(err.message || 'Falha no cadastro');
    }
  });

  els.logoutBtn.addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
  });

  els.refreshHomeBtn.addEventListener('click', () => {
    loadHome().catch((err) => setMessage(err.message || 'Falha ao atualizar'));
  });
}

async function bootstrap() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    showAuth();
    return;
  }
  try {
    await loadHome();
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
  }
}

function switchAuthTab(tab) {
  els.authTabs.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.authTab === tab));
  els.authPanels.forEach((panel) => { panel.hidden = panel.dataset.panel !== tab; });
  setMessage('');
}

function showAuth() {
  els.authScreen.hidden = false;
  els.homeScreen.hidden = true;
  setMessage('');
}

async function loadHome() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error('Sessao expirada');
  const data = await api('/api/player/home', { headers: { Authorization: `Bearer ${token}` } });

  els.authScreen.hidden = true;
  els.homeScreen.hidden = false;
  els.welcomeName.textContent = data.user?.name ? `Olá, ${data.user.name}` : 'Minha área';

  if (!data.linked) {
    els.linkPendingBox.hidden = false;
    els.linkPendingText.textContent = data.message || 'Aguardando vínculo no painel.';
    els.teamBox.innerHTML = '<p class="team-note">Sem time vinculado ainda.</p>';
    els.myCards.innerHTML = stat('🟨 Amarelos', 0) + stat('🟥 Vermelhos', 0) + stat('⚽ Gols', 0);
    els.teammatesList.innerHTML = '<p class="team-note">Nenhum companheiro para exibir.</p>';
    return;
  }

  els.linkPendingBox.hidden = true;

  const team = data.team;
  if (team) {
    els.teamBox.innerHTML = `
      <div class="team-pill"><span class="team-dot" style="background:${esc(team.color || '#0f766e')}"></span>${esc(team.name)}</div>
      <p class="team-note">Você está vinculado a este time no campeonato.</p>`;
  } else {
    els.teamBox.innerHTML = '<p class="team-note">Você ainda não foi colocado em um time.</p>';
  }

  els.myCards.innerHTML =
    stat('🟨 Amarelos', data.player?.yellowCards || 0) +
    stat('🟥 Vermelhos', data.player?.redCards || 0) +
    stat('⚽ Gols', data.player?.goals || 0);

  const mates = Array.isArray(data.teammates) ? data.teammates : [];
  els.teammatesList.innerHTML = mates.length
    ? mates.map((m) => `
      <article class="mate">
        <div class="mate-top">
          <div class="mate-name">${esc(m.name)} ${m.number != null ? `#${m.number}` : ''}</div>
          ${m.isMe ? '<span class="badge-me">Você</span>' : ''}
        </div>
        <div class="mate-stats">
          <span>🟨 ${m.yellowCards || 0}</span>
          <span>🟥 ${m.redCards || 0}</span>
          <span>⚽ ${m.goals || 0}</span>
        </div>
      </article>`).join('')
    : '<p class="team-note">Nenhum companheiro para exibir.</p>';
}

function stat(label, value) {
  return `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`;
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

function setMessage(text) {
  els.authMessage.textContent = text || '';
}

function esc(v) {
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
