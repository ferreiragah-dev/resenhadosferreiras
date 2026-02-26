const TOKEN_KEY = 'resenha-player-token';
let countdownInterval = null;

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
  countdownSubtitle: document.getElementById('countdownSubtitle'),
  countdownFooter: document.getElementById('countdownFooter'),
  days: document.getElementById('days'),
  hours: document.getElementById('hours'),
  minutes: document.getElementById('minutes'),
  seconds: document.getElementById('seconds'),
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
    stopCountdown();
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
  });

  els.refreshHomeBtn.addEventListener('click', () => {
    loadHome().catch((err) => setMessage(err.message || 'Falha ao atualizar'));
  });
}

async function bootstrap() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return showAuth();
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
  stopCountdown();
  els.authScreen.hidden = false;
  els.homeScreen.hidden = true;
}

async function loadHome() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error('Sessao expirada');
  const data = await api('/api/player/home', { headers: { Authorization: `Bearer ${token}` } });

  els.authScreen.hidden = true;
  els.homeScreen.hidden = false;
  els.welcomeName.textContent = '⚽ A resenha ja vai comecar';
  els.countdownSubtitle.textContent = data.user?.name
    ? `${data.user.name}, prepare a camisa, a gelada e o grito de gol`
    : 'Prepare a camisa, a gelada e o grito de gol';
  els.countdownFooter.textContent = '⏱ Contagem regressiva para a resenha do futebol';

  startCountdown(data.settings?.eventStartAt || '');

  if (!data.linked) {
    els.linkPendingBox.hidden = false;
    els.linkPendingText.textContent = data.message || 'Aguardando vinculo no painel.';
    els.teamBox.innerHTML = '<p class="team-note">Sem time vinculado ainda.</p>';
    els.myCards.innerHTML = stat('🟨 Amarelos', 0) + stat('🟥 Vermelhos', 0) + stat('⚽ Gols', 0);
    els.teammatesList.innerHTML = '<p class="team-note">Nenhum companheiro para exibir.</p>';
    return;
  }

  els.linkPendingBox.hidden = true;

  if (data.team) {
    els.teamBox.innerHTML = `
      <div class="team-pill"><span class="team-dot" style="background:${esc(data.team.color || '#22c55e')}"></span>${esc(data.team.name)}</div>
      <p class="team-note">Voce esta neste time da resenha.</p>`;
  } else {
    els.teamBox.innerHTML = '<p class="team-note">Voce ainda nao foi colocado em um time.</p>';
  }

  els.myCards.innerHTML =
    stat('🟨 Amarelos', data.player?.yellowCards || 0) +
    stat('🟥 Vermelhos', data.player?.redCards || 0) +
    stat('⚽ Gols', data.player?.goals || 0);

  const mates = Array.isArray(data.teammates) ? data.teammates : [];
  els.teammatesList.innerHTML = mates.length ? mates.map(renderMate).join('') : '<p class="team-note">Nenhum companheiro para exibir.</p>';
}

function startCountdown(eventStartAt) {
  stopCountdown();

  if (!eventStartAt) {
    setCountdownValues(0, 0, 0, 0);
    els.countdownFooter.textContent = '⏱ Horario da resenha ainda nao foi definido no PWA.';
    return;
  }

  const target = new Date(eventStartAt).getTime();
  if (!Number.isFinite(target)) {
    setCountdownValues(0, 0, 0, 0);
    els.countdownFooter.textContent = '⏱ Horario invalido configurado para a resenha.';
    return;
  }

  const tick = () => {
    const now = Date.now();
    const diff = target - now;

    if (diff <= 0) {
      setCountdownValues(0, 0, 0, 0);
      els.welcomeName.textContent = '⚽ A resenha comecou!';
      els.countdownFooter.textContent = 'Bora jogar!';
      stopCountdown();
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    setCountdownValues(days, hours, minutes, seconds);
    els.countdownFooter.textContent = `⏱ Contagem regressiva para ${formatDateTime(eventStartAt)}`;
  };

  tick();
  countdownInterval = setInterval(tick, 1000);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function setCountdownValues(days, hours, minutes, seconds) {
  els.days.textContent = String(days);
  els.hours.textContent = String(hours).padStart(2, '0');
  els.minutes.textContent = String(minutes).padStart(2, '0');
  els.seconds.textContent = String(seconds).padStart(2, '0');
}

function renderMate(m) {
  return `
    <article class="mate">
      <div class="mate-top">
        <div class="mate-name">${esc(m.name)} ${m.number != null ? `#${m.number}` : ''}</div>
        ${m.isMe ? '<span class="badge-me">Voce</span>' : ''}
      </div>
      <div class="mate-stats">
        <span>🟨 ${m.yellowCards || 0}</span>
        <span>🟥 ${m.redCards || 0}</span>
        <span>⚽ ${m.goals || 0}</span>
      </div>
    </article>`;
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
  if (!res.ok) throw new Error(data.error || 'Erro na requisicao');
  return data;
}

function setMessage(text) {
  els.authMessage.textContent = text || '';
}

function formatDateTime(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return 'horario da resenha';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function esc(v) {
  return String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
