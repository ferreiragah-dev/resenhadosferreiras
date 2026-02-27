const TOKEN_KEY = 'resenha-player-token';
const PUBLIC_TEAMS_CACHE_KEY = 'resenha-public-teams-cache';
const HOME_CACHE_KEY = 'resenha-player-home-cache-v2';

const els = {
  authScreen: document.getElementById('authScreen'),
  playerLoginView: document.getElementById('playerLoginView'),
  playerRegisterView: document.getElementById('playerRegisterView'),
  goToRegisterLink: document.getElementById('goToRegisterLink'),
  goToLoginLink: document.getElementById('goToLoginLink'),
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  loginSubmitBtn: document.getElementById('loginSubmitBtn'),
  registerSubmitBtn: document.getElementById('registerSubmitBtn'),
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
      setMessage('', '');
      var email = String(els.loginEmail.value || '').trim();
      var password = String(els.loginPassword.value || '');
      if (!email || !isEmailValid(email)) {
        setMessage('Informe um email valido.', 'error');
        els.loginEmail.focus();
        return;
      }
      if (!password) {
        setMessage('Informe sua senha.', 'error');
        els.loginPassword.focus();
        return;
      }
      setLoading(els.loginSubmitBtn, true, 'Entrando...');
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: email, password: password })
        });
        localStorage.setItem(TOKEN_KEY, data.token);
        setMessage('Login realizado. Carregando seus dados...', 'success');
        await prefetchHomeCache(data.token);
        window.location.href = '/player/home';
      } catch (err) {
        console.error('Erro no login:', err);
        setMessage(err.message || 'Falha no login', 'error');
      } finally {
        setLoading(els.loginSubmitBtn, false, 'Entrar');
      }
    });
  }

  if (els.registerForm) {
    els.registerForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      setMessage('', '');
      var name = String(els.registerName.value || '').trim();
      var email = String(els.registerEmail.value || '').trim();
      var password = String(els.registerPassword.value || '');
      if (name.length < 2) {
        setMessage('Informe seu nome completo.', 'error');
        els.registerName.focus();
        return;
      }
      if (!email || !isEmailValid(email)) {
        setMessage('Informe um email valido.', 'error');
        els.registerEmail.focus();
        return;
      }
      if (password.length < 4) {
        setMessage('A senha deve ter ao menos 4 caracteres.', 'error');
        els.registerPassword.focus();
        return;
      }
      setLoading(els.registerSubmitBtn, true, 'Cadastrando...');
      try {
        const data = await api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: name,
            email: email,
            password: password,
            teamId: els.registerTeamSelect ? els.registerTeamSelect.value : '',
            teamName: getSelectedTeamName()
          })
        });
        localStorage.setItem(TOKEN_KEY, data.token);
        setMessage('Conta criada. Carregando seus dados...', 'success');
        await prefetchHomeCache(data.token);
        window.location.href = '/player/home';
      } catch (err) {
        console.error('Erro no cadastro:', err);
        setMessage(err.message || 'Falha no cadastro', 'error');
      } finally {
        setLoading(els.registerSubmitBtn, false, 'Cadastrar');
      }
    });
  }

  Array.prototype.slice.call(document.querySelectorAll('[data-pass-toggle]')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId = btn.getAttribute('data-pass-toggle');
      var input = targetId ? document.getElementById(targetId) : null;
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Ocultar' : 'Mostrar';
    });
  });
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
  setMessage('', '');
  setTimeout(function () {
    if (view === 'register' && els.registerName) els.registerName.focus();
    if (view === 'login' && els.loginEmail) els.loginEmail.focus();
  }, 0);
}

async function populateRegisterTeams() {
  if (!els.registerTeamSelect) return;
  var currentValue = els.registerTeamSelect.value || '';
  try {
    const teams = await loadPublicTeams();
    if (!teams.length) {
      els.registerTeamSelect.innerHTML = '<option value="">Nenhum time cadastrado</option>';
      setMessage('Nenhum time disponivel agora. Voce pode continuar sem selecionar.', 'info');
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
    const data = await api('/api/public/teams');
    const teams = data && Array.isArray(data.teams) ? data.teams : [];
    cachePublicTeams(teams);
    return teams;
  } catch (_err) {
    const roster = await api('/api/public/roster');
    const rosterTeams = roster && Array.isArray(roster.teams) ? roster.teams : [];
    cachePublicTeams(rosterTeams);
    return rosterTeams;
  }
}

async function prefetchHomeCache(token) {
  if (!token) return;
  var controller = typeof AbortController === 'function' ? new AbortController() : null;
  var timeoutId = setTimeout(function () {
    if (controller) controller.abort();
  }, 1200);
  try {
    const data = await api('/api/player/home', {
      headers: { Authorization: 'Bearer ' + token },
      signal: controller ? controller.signal : undefined
    });
    if (data && typeof data === 'object' && data.linked) {
      var raw = JSON.stringify(data);
      sessionStorage.setItem('resenha-player-home-cache-session-v2', raw);
      localStorage.setItem(HOME_CACHE_KEY, raw);
    }
  } catch (_err) {
    // Prefetch is best effort; navigation should continue.
  } finally {
    clearTimeout(timeoutId);
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
  const res = await fetch(url, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, opts, { headers: headers }));
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || 'Erro na requisicao');
  return data;
}

function setMessage(text, type) {
  if (!els.authMessage) return;
  els.authMessage.textContent = text || '';
  els.authMessage.classList.remove('error', 'success', 'info');
  if (text && type) els.authMessage.classList.add(type);
}

function setLoading(button, loading, label) {
  if (!button) return;
  button.disabled = !!loading;
  button.textContent = label;
}

function isEmailValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
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

