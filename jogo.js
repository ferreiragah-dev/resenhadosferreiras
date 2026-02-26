document.addEventListener('DOMContentLoaded', function () {
  var teamA = document.getElementById('teamA');
  var teamB = document.getElementById('teamB');
  var playBtn = document.getElementById('playBtn');

  loadTeams();

  if (playBtn) {
    playBtn.addEventListener('click', startMatch);
  }

  async function loadTeams() {
    try {
      var data = await api('/api/public/teams');
      var teams = Array.isArray(data.teams) ? data.teams : [];
      var options = '<option value="">Selecione</option>' + teams.map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
      }).join('');
      teamA.innerHTML = options;
      teamB.innerHTML = options;
    } catch (_err) {
      // Mantem select vazio se falhar
    }
  }

  function startMatch() {
    var aId = teamA.value;
    var bId = teamB.value;
    var aName = getText(teamA);
    var bName = getText(teamB);

    if (!aId || !bId) {
      alert('Selecione os dois times.');
      return;
    }
    if (aId === bId) {
      alert('Os times devem ser diferentes.');
      return;
    }

    var url = '/jogo/ao-vivo?teamA=' + encodeURIComponent(aId) +
      '&teamB=' + encodeURIComponent(bId) +
      '&teamAName=' + encodeURIComponent(aName) +
      '&teamBName=' + encodeURIComponent(bName);
    window.location.href = url;
  }

  function getText(select) {
    if (!select) return '';
    var opt = select.options[select.selectedIndex];
    return opt ? opt.text : '';
  }

  registerSw();
});

async function api(url) {
  var res = await fetch(url);
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || 'Erro');
  return data;
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
