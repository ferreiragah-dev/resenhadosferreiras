const TOKEN_KEY = 'resenha-player-token';
const PUBLIC_TEAMS_CACHE_KEY = 'resenha-public-teams-cache';

const els = {
  authScreen: document.getElementById('authScreen'),
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
  registerTeamSelect: document.getElementById('registerTeamSelect')
};

bindEvents();
bootstrap();

function bindEvents() {
  if (els.goToRegisterLink) {
    els.goToRegisterLink.addEventListener('click', function (e) {
      e.preventDefault();
      populateRegisterTeams().catch(function () {});
      switchAuthView('register');
    });
  }

  if (els.goToLoginLink) {
    els.goToLoginLink.addEventListener('click', function (e) {
      e.preventDefault();
      switchAuthView('login');
    });
  }

  if (els.loginForm) {
    els.loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      setMessage('');
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: els.loginEmail.value, password: els.loginPassword.value })
        });
        localStorage.setItem(TOKEN_KEY, data.token);
        window.location.href = '/player/home';
      } catch (err) {
        console.error('Erro no login:', err);
        setMessage(err.message || 'Falha no login');
      }
    });
  }

  if (els.registerForm) {
    els.registerForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      setMessage('');
      try {
        const data = await api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: els.registerName.value,
            email: els.registerEmail.value,
            password: els.registerPassword.value,
            teamId: els.registerTeamSelect ? els.registerTeamSelect.value : '',
            teamName: getSelectedTeamName()
          })
        });
        localStorage.setItem(TOKEN_KEY, data.token);
        window.location.href = '/player/home';
      } catch (err) {
        console.error('Erro no cadastro:', err);
        setMessage(err.message || 'Falha no cadastro');
      }
    });
  }
}

async function bootstrap() {
  await populateRegisterTeams();
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    switchAuthView('login');
    return;
  }

  try {
    await api('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
    window.location.href = '/player/home';
  } catch (_err) {
    localStorage.removeItem(TOKEN_KEY);
    switchAuthView('login');
  }
}

function switchAuthView(view) {
  if (els.playerLoginView) els.playerLoginView.hidden = view !== 'login';
  if (els.playerRegisterView) els.playerRegisterView.hidden = view !== 'register';
  setMessage('');
}

async function populateRegisterTeams() {
  if (!els.registerTeamSelect) return;
  var currentValue = els.registerTeamSelect.value || '';
  try {
    const teams = await loadPublicTeams();
    if (!teams.length) {
      els.registerTeamSelect.innerHTML = '<option value="">Nenhum time cadastrado</option>';
      return;
    }
    els.registerTeamSelect.innerHTML = '<option value="">Selecione</option>' +
      teams.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'); })
        .map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>'; })
        .join('');
    if (currentValue) els.registerTeamSelect.value = currentValue;
  } catch (_err) {
    var cachedTeams = readCachedTeams();
    if (cachedTeams.length) {
      els.registerTeamSelect.innerHTML = '<option value="">Selecione</option>' +
        cachedTeams.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>'; }).join('');
      if (currentValue) els.registerTeamSelect.value = currentValue;
      return;
    }
    els.registerTeamSelect.innerHTML = '<option value="">Erro ao carregar times</option>';
  }
}

async function loadPublicTeams() {
  try {
    const data = await api('/api/public/teams?ts=' + Date.now());
    const teams = data && Array.isArray(data.teams) ? data.teams : [];
    cachePublicTeams(teams);
    return teams;
  } catch (_err) {
    const roster = await api('/api/public/roster?ts=' + Date.now());
    const rosterTeams = roster && Array.isArray(roster.teams) ? roster.teams : [];
    cachePublicTeams(rosterTeams);
    return rosterTeams;
  }
}

function cachePublicTeams(teams) {
  try {
    var normalized = Array.isArray(teams) ? teams.map(function (t) {
      return { id: String(t.id || ''), name: String(t.name || '') };
    }).filter(function (t) { return t.id && t.name; }) : [];
    localStorage.setItem(PUBLIC_TEAMS_CACHE_KEY, JSON.stringify(normalized));
  } catch (_err) {}
}

function readCachedTeams() {
  try {
    var raw = localStorage.getItem(PUBLIC_TEAMS_CACHE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

async function api(url, options) {
  const opts = options || {};
  const headers = Object.assign({}, opts.headers || {});
  const method = String(opts.method || 'GET').toUpperCase();
  if (method !== 'GET' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, Object.assign({}, opts, { headers: headers }));
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || 'Erro na requisicao');
  return data;
}

function setMessage(text) {
  if (els.authMessage) els.authMessage.textContent = text || '';
}

function getSelectedTeamName() {
  if (!els.registerTeamSelect) return '';
  var option = els.registerTeamSelect.options[els.registerTeamSelect.selectedIndex];
  if (!option) return '';
  return String(option.text || '').trim() === 'Selecione' ? '' : String(option.text || '').trim();
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
