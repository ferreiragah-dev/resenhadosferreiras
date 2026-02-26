import express from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'troque-essa-chave-no-easypanel';
const DATABASE_URL = process.env.DATABASE_URL;
const dataDir = path.join(__dirname, 'data');
const legacyStorePath = path.join(dataDir, 'store.json');

if (!DATABASE_URL) {
  console.error('DATABASE_URL nao configurada. Defina a conexao Postgres no EasyPanel.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: parseSslMode(DATABASE_URL) ? { rejectUnauthorized: false } : false
});

fs.mkdirSync(dataDir, { recursive: true });

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

function defaultTournament() {
  return { teams: [], players: [], matches: [], bracket: [], liveGame: null, recentGames: [], settings: { eventStartAt: '' } };
}

function normalizeTournament(input) {
  const base = defaultTournament();
  const t = input && typeof input === 'object' ? input : {};
  return {
    teams: Array.isArray(t.teams) ? t.teams : base.teams,
    players: Array.isArray(t.players) ? t.players.map((p) => ({ ...p, userId: p?.userId || '' })) : base.players,
    matches: Array.isArray(t.matches) ? t.matches : base.matches,
    bracket: Array.isArray(t.bracket) ? t.bracket : base.bracket,
    liveGame: t.liveGame && typeof t.liveGame === 'object' ? t.liveGame : null,
    recentGames: Array.isArray(t.recentGames) ? t.recentGames : [],
    settings: {
      eventStartAt: String(t?.settings?.eventStartAt || '')
    }
  };
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: Number(row.created_at ?? row.createdAt ?? Date.now())
  };
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Nao autenticado' });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalido' });
  }
}

function adminRequired(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return next();
  const token = req.headers['x-admin-token'];
  if (token !== expected) return res.status(401).json({ error: 'Admin token invalido' });
  next();
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, date: new Date().toISOString() });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const requestedTeamId = String(req.body?.teamId || '').trim();
    const requestedTeamName = String(req.body?.teamName || '').trim();

    if (!name || !email || !password) return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios' });
    if (password.length < 4) return res.status(400).json({ error: 'Senha deve ter pelo menos 4 caracteres' });

    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rowCount) return res.status(409).json({ error: 'Email ja cadastrado' });

    const user = {
      id: uid(),
      name,
      email,
      passwordHash: bcrypt.hashSync(password, 10),
      createdAt: Date.now()
    };

    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
      [user.id, user.name, user.email, user.passwordHash, user.createdAt]
    );

    // Cria automaticamente o jogador no elenco (sem time) para aparecer no PWA admin.
    const tournament = await readTournamentState();
    const teams = tournament.teams || [];
    let normalizedTeamId = '';
    if (requestedTeamId) {
      const byId = teams.find((t) => t && String(t.id) === requestedTeamId);
      if (byId) normalizedTeamId = byId.id;
    }
    if (!normalizedTeamId && requestedTeamName) {
      const byName = teams.find((t) => t && String(t.name || '').trim().toLowerCase() === requestedTeamName.toLowerCase());
      if (byName) normalizedTeamId = byName.id;
    }
    const sameNamePlayer = (tournament.players || []).find((p) => p && String(p.name || '').trim().toLowerCase() === user.name.toLowerCase());
    const linkedPlayer = (tournament.players || []).find((p) => p && p.userId === user.id);

    if (linkedPlayer) {
      if (normalizedTeamId) linkedPlayer.teamId = normalizedTeamId;
      if (!linkedPlayer.userId) linkedPlayer.userId = user.id;
      await writeTournamentState(tournament);
    } else if (sameNamePlayer) {
      sameNamePlayer.userId = user.id;
      if (normalizedTeamId) sameNamePlayer.teamId = normalizedTeamId;
      await writeTournamentState(tournament);
    } else {
      tournament.players.push({
        id: uid(),
        name: user.name,
        number: null,
        position: '',
        teamId: normalizedTeamId,
        userId: user.id,
        photoDataUrl: '',
        yellowCards: 0,
        redCards: 0,
        goals: 0,
        assists: 0,
        goalsPro: 0,
        goalsContra: 0,
        isCaptain: false,
        createdAt: Date.now()
      });
      await writeTournamentState(tournament);
    }

    res.status(201).json({ token: issueToken(user), user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt } });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao cadastrar usuario' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Email ou senha invalidos' });
    }

    res.json({ token: issueToken({ id: user.id, email: user.email }), user: publicUser(user) });
  } catch {
    res.status(500).json({ error: 'Falha no login' });
  }
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.auth.sub]);
  const user = result.rows[0];
  if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });
  res.json({ user: publicUser(user) });
});

app.get('/api/users', adminRequired, async (_req, res) => {
  const result = await pool.query('SELECT id, name, email, created_at FROM users ORDER BY name ASC');
  res.json({ users: result.rows.map(publicUser) });
});

app.get('/api/public/teams', async (_req, res) => {
  const tournament = await readTournamentState();
  const teams = (tournament.teams || [])
    .map((t) => ({ id: t.id, name: t.name, color: t.color || '#0f766e' }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
  res.json({ teams });
});

app.get('/api/public/roster', async (_req, res) => {
  const tournament = await readTournamentState();
  const teams = (tournament.teams || []).map((t) => ({ id: t.id, name: t.name, color: t.color || '#0f766e' }));
  const players = (tournament.players || []).map((p) => ({
    id: p.id,
    name: p.name || 'Jogador',
    teamId: p.teamId || '',
    photoDataUrl: p.photoDataUrl || '',
    isCaptain: Boolean(p.isCaptain)
  }));
  res.json({ teams, players });
});

app.post('/api/public/player-action', async (req, res) => {
  try {
    const playerId = String(req.body?.playerId || '').trim();
    const action = String(req.body?.action || '').trim().toUpperCase();
    if (!playerId || !action) return res.status(400).json({ error: 'playerId e action são obrigatórios' });

    const tournament = await readTournamentState();
    const player = (tournament.players || []).find((p) => p && p.id === playerId);
    if (!player) return res.status(404).json({ error: 'Jogador não encontrado' });

    if (action === 'A') player.assists = Number(player.assists || 0) + 1;
    else if (action === 'GP') {
      player.goalsPro = Number(player.goalsPro || 0) + 1;
      player.goals = Number(player.goals || 0) + 1;
    } else if (action === 'GC') player.goalsContra = Number(player.goalsContra || 0) + 1;
    else if (action === 'CA') player.yellowCards = Number(player.yellowCards || 0) + 1;
    else if (action === 'CV') player.redCards = Number(player.redCards || 0) + 1;
    else return res.status(400).json({ error: 'Ação inválida' });

    await writeTournamentState(tournament);
    res.json({
      ok: true,
      player: {
        id: player.id,
        assists: Number(player.assists || 0),
        goals: Number(player.goals || 0),
        goalsPro: Number(player.goalsPro || 0),
        goalsContra: Number(player.goalsContra || 0),
        yellowCards: Number(player.yellowCards || 0),
        redCards: Number(player.redCards || 0)
      }
    });
  } catch {
    res.status(500).json({ error: 'Falha ao aplicar ação no jogador' });
  }
});

app.post('/api/public/live-game/start', async (req, res) => {
  try {
    const body = req.body || {};
    const tournament = await readTournamentState();
    const liveGame = {
      id: body.id || uid(),
      teamAId: String(body.teamAId || ''),
      teamBId: String(body.teamBId || ''),
      teamAName: String(body.teamAName || 'Time A'),
      teamBName: String(body.teamBName || 'Time B'),
      scoreA: Number(body.scoreA || 0),
      scoreB: Number(body.scoreB || 0),
      duration: Number(body.duration || 600),
      remaining: Number(body.remaining || 600),
      running: true,
      startedAt: Number(body.startedAt || Date.now()),
      updatedAt: Date.now()
    };
    tournament.liveGame = liveGame;
    await writeTournamentState(tournament);
    res.json({ ok: true, liveGame });
  } catch {
    res.status(500).json({ error: 'Falha ao iniciar jogo ao vivo' });
  }
});

app.post('/api/public/live-game/update', async (req, res) => {
  try {
    const body = req.body || {};
    const tournament = await readTournamentState();
    const current = tournament.liveGame && typeof tournament.liveGame === 'object' ? tournament.liveGame : null;
    if (!current) return res.status(404).json({ error: 'Nenhum jogo ao vivo' });

    if (body.id && String(body.id) !== String(current.id)) {
      return res.status(409).json({ error: 'Jogo ao vivo diferente do atual' });
    }

    current.scoreA = Number(body.scoreA ?? current.scoreA ?? 0);
    current.scoreB = Number(body.scoreB ?? current.scoreB ?? 0);
    current.remaining = Number(body.remaining ?? current.remaining ?? 0);
    current.duration = Number(body.duration ?? current.duration ?? 600);
    if (typeof body.running !== 'undefined') current.running = Boolean(body.running);
    current.updatedAt = Date.now();

    tournament.liveGame = current;
    await writeTournamentState(tournament);
    res.json({ ok: true, liveGame: current });
  } catch {
    res.status(500).json({ error: 'Falha ao atualizar jogo ao vivo' });
  }
});

app.post('/api/public/live-game/end', async (req, res) => {
  try {
    const body = req.body || {};
    const tournament = await readTournamentState();
    const current = tournament.liveGame && typeof tournament.liveGame === 'object' ? tournament.liveGame : null;
    if (!current) return res.status(404).json({ error: 'Nenhum jogo ao vivo' });

    if (body.id && String(body.id) !== String(current.id)) {
      return res.status(409).json({ error: 'Jogo ao vivo diferente do atual' });
    }

    current.scoreA = Number(body.scoreA ?? current.scoreA ?? 0);
    current.scoreB = Number(body.scoreB ?? current.scoreB ?? 0);
    current.remaining = Number(body.remaining ?? current.remaining ?? 0);
    current.running = false;
    current.endedAt = Date.now();
    current.updatedAt = Date.now();
    current.status = 'finished';

    const recent = Array.isArray(tournament.recentGames) ? tournament.recentGames : [];
    recent.unshift(current);
    tournament.recentGames = recent.slice(0, 20);
    tournament.liveGame = null;

    await writeTournamentState(tournament);
    res.json({ ok: true, recentGame: current });
  } catch {
    res.status(500).json({ error: 'Falha ao encerrar jogo ao vivo' });
  }
});

app.get('/api/state', adminRequired, async (_req, res) => {
  res.json({ tournament: await readTournamentState() });
});

app.put('/api/state', adminRequired, async (req, res) => {
  const current = await readTournamentState();
  const incoming = req.body?.tournament && typeof req.body.tournament === 'object' ? req.body.tournament : {};
  const merged = {
    ...current,
    ...incoming,
    liveGame: Object.prototype.hasOwnProperty.call(incoming, 'liveGame') ? incoming.liveGame : current.liveGame,
    recentGames: Array.isArray(incoming.recentGames) ? incoming.recentGames : current.recentGames,
    settings: { ...(current.settings || {}), ...(incoming.settings || {}) }
  };
  const tournament = await writeTournamentState(merged);
  const row = await pool.query('SELECT updated_at FROM tournament_state WHERE id = 1');
  res.json({ ok: true, tournament, updatedAt: row.rows[0]?.updated_at || Date.now() });
});

app.get('/api/player/home', authRequired, async (req, res) => {
  const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.auth.sub]);
  const user = userRes.rows[0];
  if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });

  const tournament = await readTournamentState();
  const player = tournament.players.find((p) => p.userId === user.id);

  if (!player) {
    return res.json({
      user: publicUser(user),
      linked: false,
      settings: {
        eventStartAt: String(tournament.settings?.eventStartAt || '')
      },
      message: 'Seu cadastro existe, mas ainda nao foi vinculado a um jogador no painel do campeonato.'
    });
  }

  const team = tournament.teams.find((t) => t.id === player.teamId) || null;
  const teamsById = new Map((tournament.teams || []).map((t) => [t.id, t]));
  const teamStats = team
    ? tournament.matches.reduce((acc, m) => {
        if (m.teamAId !== team.id && m.teamBId !== team.id) return acc;
        const isA = m.teamAId === team.id;
        acc.goalsFor += Number(isA ? m.goalsA : m.goalsB) || 0;
        acc.goalsAgainst += Number(isA ? m.goalsB : m.goalsA) || 0;
        return acc;
      }, { goalsFor: 0, goalsAgainst: 0 })
    : { goalsFor: 0, goalsAgainst: 0 };
  const teammates = team
    ? tournament.players
        .filter((p) => p.teamId === team.id)
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
        .map((p) => ({
          id: p.id,
          name: p.name,
          number: p.number ?? null,
          yellowCards: p.yellowCards || 0,
          redCards: p.redCards || 0,
          goals: p.goals || 0,
          assists: p.assists || 0,
          goalsPro: p.goalsPro || 0,
          goalsContra: p.goalsContra || 0,
          isCaptain: Boolean(p.isCaptain),
          photoDataUrl: p.photoDataUrl || '',
          isMe: p.id === player.id
        }))
    : [];

  const matches = team
    ? (tournament.matches || [])
        .filter((m) => m.teamAId === team.id || m.teamBId === team.id)
        .sort((a, b) => {
          const da = String(a.date || '');
          const db = String(b.date || '');
          if (da !== db) return db.localeCompare(da);
          return Number(b.createdAt || 0) - Number(a.createdAt || 0);
        })
        .slice(0, 20)
        .map((m) => {
          const teamA = teamsById.get(m.teamAId);
          const teamB = teamsById.get(m.teamBId);
          const playerGoals = Array.isArray(m.goalEvents)
            ? m.goalEvents.filter((g) => g && g.playerId === player.id).length
            : 0;
          return {
            id: m.id,
            date: m.date || '',
            stage: m.stage || 'Pelada',
            teamAName: (teamA && teamA.name) || 'Time A',
            teamBName: (teamB && teamB.name) || 'Time B',
            goalsA: Number(m.goalsA || 0),
            goalsB: Number(m.goalsB || 0),
            playerStats: {
              goals: playerGoals,
              assists: 0,
              yellowCards: 0,
              redCards: 0
            }
          };
        })
    : [];

  const standings = (tournament.teams || []).map((t) => {
    const s = t && t.stats && typeof t.stats === 'object' ? t.stats : {};
    return {
      id: t.id,
      name: t.name,
      color: t.color || '#0f766e',
      points: Number(s.points || 0),
      games: Number(s.games || 0),
      wins: Number(s.wins || 0),
      draws: Number(s.draws || 0),
      losses: Number(s.losses || 0),
      goalsPro: Number(s.goalsPro || 0),
      goalsContra: Number(s.goalsContra || 0),
      goalDiff: Number(s.goalDiff || 0)
    };
  }).sort((a, b) =>
    b.points - a.points ||
    b.goalDiff - a.goalDiff ||
    b.goalsPro - a.goalsPro ||
    String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
  );

  res.json({
    user: publicUser(user),
    linked: true,
    settings: {
      eventStartAt: String(tournament.settings?.eventStartAt || '')
    },
    player: {
      id: player.id,
      name: player.name,
      number: player.number ?? null,
      position: player.position || '',
      yellowCards: player.yellowCards || 0,
      redCards: player.redCards || 0,
      goals: player.goals || 0,
      assists: player.assists || 0,
      goalsPro: player.goalsPro || 0,
      goalsContra: player.goalsContra || 0,
      isCaptain: Boolean(player.isCaptain),
      photoDataUrl: player.photoDataUrl || ''
    },
    team: team ? { id: team.id, name: team.name, color: team.color || '#0f766e' } : null,
    teamStats,
    teammates,
    matches,
    standings,
    liveGame: tournament.liveGame || null,
    recentGames: Array.isArray(tournament.recentGames) ? tournament.recentGames : []
  });
});

app.use(express.static(__dirname, { extensions: ['html'] }));

app.get('/', (_req, res) => res.redirect('/admin'));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/jogo', (_req, res) => res.sendFile(path.join(__dirname, 'jogo.html')));
app.get('/jogo/ao-vivo', (_req, res) => res.sendFile(path.join(__dirname, 'jogo-live.html')));
app.get('/player/home', (_req, res) => res.sendFile(path.join(__dirname, 'player-home.html')));
app.get('/player', (_req, res) => res.sendFile(path.join(__dirname, 'player.html')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota nao encontrada' });
  // Nao redireciona arquivos estaticos ausentes para /admin (isso quebra CSS/JS com MIME errado).
  if (/\.[a-zA-Z0-9]+$/.test(req.path)) return res.status(404).send('Arquivo nao encontrado');
  res.redirect('/admin');
});

await initDb();
await migrateLegacyJsonIfNeeded();

app.listen(PORT, () => {
  console.log(`Resenha Ferreira rodando na porta ${PORT}`);
  console.log('Postgres conectado');
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tournament_state (
      id INTEGER PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at BIGINT NOT NULL
    );
  `);

  const existing = await pool.query('SELECT id FROM tournament_state WHERE id = 1');
  if (!existing.rowCount) {
    await pool.query('INSERT INTO tournament_state (id, payload, updated_at) VALUES (1, $1::jsonb, $2)', [JSON.stringify(defaultTournament()), Date.now()]);
  }
}

async function readTournamentState() {
  const res = await pool.query('SELECT payload FROM tournament_state WHERE id = 1');
  const payload = res.rows[0]?.payload;
  return normalizeTournament(payload);
}

async function writeTournamentState(tournament) {
  const normalized = normalizeTournament(tournament);
  await pool.query('UPDATE tournament_state SET payload = $1::jsonb, updated_at = $2 WHERE id = 1', [JSON.stringify(normalized), Date.now()]);
  return normalized;
}

async function migrateLegacyJsonIfNeeded() {
  if (!fs.existsSync(legacyStorePath)) return;
  try {
    const usersCount = Number((await pool.query('SELECT COUNT(*)::int AS c FROM users')).rows[0]?.c || 0);
    const current = await readTournamentState();
    const hasTournamentData = (current.teams.length + current.players.length + current.matches.length + current.bracket.length) > 0;
    if (usersCount > 0 || hasTournamentData) return;

    const legacy = JSON.parse(fs.readFileSync(legacyStorePath, 'utf8'));
    const users = Array.isArray(legacy.users) ? legacy.users : [];
    const tournament = normalizeTournament(legacy.tournament);

    for (const u of users) {
      if (!u?.id || !u?.email || !u?.passwordHash) continue;
      await pool.query(
        'INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING',
        [String(u.id), String(u.name || ''), String(u.email || '').toLowerCase(), String(u.passwordHash), Number(u.createdAt || Date.now())]
      );
    }

    await writeTournamentState(tournament);
    console.log('Migracao de data/store.json para Postgres concluida.');
  } catch (err) {
    console.warn('Falha ao migrar store.json para Postgres:', err.message);
  }
}

function parseSslMode(url) {
  try {
    const parsed = new URL(url);
    const mode = parsed.searchParams.get('sslmode');
    return mode && mode !== 'disable';
  } catch {
    return false;
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
