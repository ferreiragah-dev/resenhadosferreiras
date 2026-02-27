document.addEventListener('DOMContentLoaded', function () {
  var teamA = document.getElementById('teamA');
  var teamB = document.getElementById('teamB');
  var playBtn = document.getElementById('playBtn');
  var scheduleList = document.getElementById('scheduleList');

  loadTeams();
  loadSchedule();

  if (playBtn) {
    playBtn.addEventListener('click', startManualMatch);
  }

  async function loadTeams() {
    try {
      var data = await api('/api/public/teams');
      var teams = Array.isArray(data.teams) ? data.teams : [];
      var options = '<option value="">Selecione</option>' + teams.map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
      }).join('');
      if (teamA) teamA.innerHTML = options;
      if (teamB) teamB.innerHTML = options;
    } catch (_err) {
      // Mantem select vazio se falhar
    }
  }

  async function loadSchedule() {
    if (!scheduleList) return;
    try {
      var data = await api('/api/public/schedule');
      var items = Array.isArray(data.schedule) ? data.schedule : [];
      renderSchedule(items);
    } catch (_err) {
      scheduleList.innerHTML = '<div class="schedule-item">Nao foi possivel carregar a agenda.</div>';
    }
  }

  function renderSchedule(items) {
    if (!scheduleList) return;
    if (!items.length) {
      scheduleList.innerHTML = '<div class="schedule-item">Nenhum jogo na agenda.</div>';
      return;
    }

    var lastPhase = '';
    scheduleList.innerHTML = items.map(function (g) {
      var phase = String(g.phase || 'Fase');
      var showPhase = phase !== lastPhase;
      lastPhase = phase;
      return (showPhase ? '<div class="schedule-phase">' + esc(phase) + '</div>' : '') +
        '<div class="schedule-item">' +
          '<div class="schedule-row"><span><strong>' + esc(g.time || '--:--') + '</strong></span><span>' + esc(g.groupLabel || '') + '</span></div>' +
          '<div class="schedule-vs">' + teamLabelHtml(g.teamALabel || 'Time A', g.teamALogoDataUrl || '') + ' x ' + teamLabelHtml(g.teamBLabel || 'Time B', g.teamBLogoDataUrl || '') + '</div>' +
          '<div class="schedule-meta">' + (g.canStart ? 'Pronto para iniciar' : 'Aguardando definicao dos times') + '</div>' +
          '<button class="schedule-start-btn" ' + (g.canStart ? '' : 'disabled') + ' data-schedule-start="' + esc(g.id) + '">Iniciar</button>' +
        '</div>';
    }).join('');

    Array.prototype.slice.call(scheduleList.querySelectorAll('[data-schedule-start]')).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-schedule-start');
        var game = items.find(function (x) { return String(x.id) === String(id); });
        if (!game || !game.canStart) return;
        startMatch(game.teamAId, game.teamBId, game.teamAName, game.teamBName);
      });
    });
  }

  function startManualMatch() {
    var aId = teamA ? teamA.value : '';
    var bId = teamB ? teamB.value : '';
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

    startMatch(aId, bId, aName, bName);
  }

  function startMatch(aId, bId, aName, bName) {
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

  function teamLabelHtml(name, logoDataUrl) {
    var n = esc(name || 'Time');
    if (logoDataUrl) return '<span class="team-label"><span class="team-logo"><img src="' + esc(logoDataUrl) + '" alt="' + n + '"></span><span>' + n + '</span></span>';
    return '<span class="team-label"><span>' + n + '</span></span>';
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
