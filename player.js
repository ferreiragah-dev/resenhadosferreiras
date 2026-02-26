const TOKEN_KEY = 'resenha-player-token';

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
  try {
    const data = await api('/api/public/teams');
    const teams = data && Array.isArray(data.teams) ? data.teams : [];
    els.registerTeamSelect.innerHTML = '<option value="">Selecione</option>' +
      teams.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'); })
        .map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>'; })
        .join('');
  } catch (_err) {
    els.registerTeamSelect.innerHTML = '<option value="">Selecione</option>';
  }
}

async function api(url, options) {
  const opts = options || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
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
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
