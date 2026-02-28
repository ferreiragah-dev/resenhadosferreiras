import express from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import webpush from 'web-push';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'troque-essa-chave-no-easypanel';
const DATABASE_URL = process.env.DATABASE_URL;
const FORCE_HTTPS = String(process.env.FORCE_HTTPS || '').trim() === '1';
const VAPID_PUBLIC_KEY = sanitizeEnvValue(process.env.VAPID_PUBLIC_KEY);
const VAPID_PRIVATE_KEY = sanitizeEnvValue(process.env.VAPID_PRIVATE_KEY);
const VAPID_SUBJECT = sanitizeEnvValue(process.env.VAPID_SUBJECT || 'mailto:admin@resenhadosferreiras.com');
const dataDir = path.join(__dirname, 'data');
const legacyStorePath = path.join(dataDir, 'store.json');
const livePushDedup = new Map();

if (!DATABASE_URL) {
  console.error('DATABASE_URL nao configurada. Defina a conexao Postgres no EasyPanel.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: parseSslMode(DATABASE_URL) ? { rejectUnauthorized: false } : false
});

fs.mkdirSync(dataDir, { recursive: true });
app.set('trust proxy', 1);

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    console.log(`Push VAPID configurado. subject=${VAPID_SUBJECT} pub=${VAPID_PUBLIC_KEY.slice(0, 12)}...`);
  } catch (err) {
    console.warn('Falha ao configurar VAPID:', err.message);
  }
} else {
  console.warn('Push desativado: configure VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY no ambiente.');
}

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  if (!FORCE_HTTPS) return next();
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (proto && proto !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
});

function defaultTournament() {
  return { teams: [], players: [], matches: [], gameSchedule: [], bracket: [], liveGame: null, recentGames: [], settings: { eventStartAt: '' } };
}

function normalizeTournament(input) {
  const base = defaultTournament();
  const t = input && typeof input === 'object' ? input : {};
  return {
    teams: Array.isArray(t.teams) ? t.teams : base.teams,
    players: Array.isArray(t.players) ? t.players.map((p) => ({ ...p, userId: p?.userId || '' })) : base.players,
    matches: Array.isArray(t.matches) ? t.matches : base.matches,
    gameSchedule: Array.isArray(t.gameSchedule) ? t.gameSchedule : base.gameSchedule,
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

app.get('/api/push/public-key', authRequired, async (_req, res) => {
  if (!isPushConfigured()) {
    return res.json({
      enabled: false,
      error: pushConfigErrorMessage(),
      missing: getMissingPushConfig()
    });
  }
  res.json({ enabled: true, publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', authRequired, async (req, res) => {
  try {
    if (!isPushConfigured()) return res.status(400).json({ error: pushConfigErrorMessage(), missing: getMissingPushConfig() });
    const sub = req.body?.subscription && typeof req.body.subscription === 'object' ? req.body.subscription : null;
    const endpoint = String(sub?.endpoint || '').trim();
    if (!sub || !endpoint) return res.status(400).json({ error: 'Subscription invalida' });
    const now = Date.now();
    await pool.query(
      `INSERT INTO push_subscriptions (endpoint, user_id, subscription, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, subscription = EXCLUDED.subscription, updated_at = EXCLUDED.updated_at`,
      [endpoint, req.auth.sub, JSON.stringify(sub), now]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Falha ao salvar subscription' });
  }
});

app.post('/api/push/unsubscribe', authRequired, async (req, res) => {
  try {
    const endpoint = String(req.body?.endpoint || '').trim();
    if (!endpoint) return res.status(400).json({ error: 'Endpoint obrigatorio' });
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [endpoint, req.auth.sub]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Falha ao remover subscription' });
  }
});

app.post('/api/push/test', adminRequired, async (req, res) => {
  try {
    if (!isPushConfigured()) return res.status(400).json({ error: pushConfigErrorMessage(), missing: getMissingPushConfig() });
    const title = String(req.body?.title || 'Resenha dos Ferreira');
    const body = String(req.body?.body || 'Teste de notificacao enviado pelo admin.');
    const url = String(req.body?.url || '/player/home');
    const userId = String(req.body?.userId || '').trim();
    const result = await sendPushNotification({ title, body, url }, userId || null);
    res.json({ ok: true, sent: result.sent, removed: result.removed, total: result.total, failed: result.failed, failures: result.failures });
  } catch {
    res.status(500).json({ error: 'Falha ao disparar notificacao push' });
  }
});

app.get('/api/push/stats', adminRequired, async (_req, res) => {
  try {
    const totalRes = await pool.query('SELECT COUNT(*)::int AS c FROM push_subscriptions');
    const byUserRes = await pool.query(`
      SELECT u.id, u.name, u.email, COUNT(ps.endpoint)::int AS subscriptions
      FROM users u
      LEFT JOIN push_subscriptions ps ON ps.user_id = u.id
      GROUP BY u.id, u.name, u.email
      ORDER BY subscriptions DESC, u.name ASC
    `);
    res.json({
      ok: true,
      total: Number(totalRes.rows?.[0]?.c || 0),
      users: Array.isArray(byUserRes.rows) ? byUserRes.rows.map((r) => ({
        id: String(r.id || ''),
        name: String(r.name || ''),
        email: String(r.email || ''),
        subscriptions: Number(r.subscriptions || 0)
      })) : []
    });
  } catch {
    res.status(500).json({ error: 'Falha ao carregar estatisticas de push' });
  }
});

app.get('/api/users', adminRequired, async (_req, res) => {
  const result = await pool.query('SELECT id, name, email, created_at FROM users ORDER BY name ASC');
  res.json({ users: result.rows.map(publicUser) });
});

app.get('/api/public/teams', async (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const tournament = await readTournamentState();
  const teams = (tournament.teams || [])
    .map((t) => ({ id: t.id, name: t.name, color: t.color || '#0f766e', logoDataUrl: t.logoDataUrl || '' }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
  res.json({ teams });
});

app.get('/api/public/roster', async (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const tournament = await readTournamentState();
  const topScorerId = getTopScorerId(tournament.players || []);
  const teams = (tournament.teams || []).map((t) => ({ id: t.id, name: t.name, color: t.color || '#0f766e', logoDataUrl: t.logoDataUrl || '' }));
  const players = (tournament.players || []).map((p) => ({
    id: p.id,
    name: p.name || 'Jogador',
    teamId: p.teamId || '',
    photoDataUrl: p.photoDataUrl || '',
    isCaptain: Boolean(p.isCaptain),
    isTopScorer: !!topScorerId && String(p.id) === String(topScorerId)
  }));
  res.json({ teams, players });
});

app.get('/api/public/schedule', async (_req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const tournament = await readTournamentState();
  const teams = (tournament.teams || []).map((t) => ({
    id: String(t.id || ''),
    name: String(t.name || ''),
    logoDataUrl: String(t.logoDataUrl || ''),
    norm: String(t.name || '').trim().toLowerCase()
  }));
  const byNorm = new Map(teams.map((t) => [t.norm, t]));
  const byId = new Map(teams.map((t) => [t.id, t]));

  const schedule = (tournament.gameSchedule || []).map((g) => {
    const aLabel = String(g.teamALabel || '').trim();
    const bLabel = String(g.teamBLabel || '').trim();
    const aId = String(g.teamAId || '').trim();
    const bId = String(g.teamBId || '').trim();
    const a = (aId ? byId.get(aId) : null) || byNorm.get(aLabel.toLowerCase()) || null;
    const b = (bId ? byId.get(bId) : null) || byNorm.get(bLabel.toLowerCase()) || null;
    const finalALabel = a ? String(a.name || '') : aLabel;
    const finalBLabel = b ? String(b.name || '') : bLabel;
    const canStart = Boolean(a && b && a.id && b.id && a.id !== b.id);
    return {
      id: String(g.id || ''),
      phase: String(g.phase || ''),
      time: String(g.time || ''),
      groupLabel: String(g.groupLabel || ''),
      teamALabel: finalALabel,
      teamBLabel: finalBLabel,
      canStart,
      teamAId: canStart ? a.id : '',
      teamBId: canStart ? b.id : '',
      teamAName: canStart ? a.name : finalALabel,
      teamBName: canStart ? b.name : finalBLabel,
      teamALogoDataUrl: canStart ? (a.logoDataUrl || '') : '',
      teamBLogoDataUrl: canStart ? (b.logoDataUrl || '') : ''
    };
  });

  res.json({ schedule });
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
    const incomingEvents = Array.isArray(body.events) ? body.events : [];
    const liveGame = {
      id: body.id || uid(),
      teamAId: String(body.teamAId || ''),
      teamBId: String(body.teamBId || ''),
      teamAName: String(body.teamAName || 'Time A'),
      teamBName: String(body.teamBName || 'Time B'),
      teamALogoDataUrl: String(body.teamALogoDataUrl || ''),
      teamBLogoDataUrl: String(body.teamBLogoDataUrl || ''),
      scoreA: Number(body.scoreA || 0),
      scoreB: Number(body.scoreB || 0),
      events: incomingEvents.slice(0, 200).map(normalizeLiveEvent),
      duration: Number(body.duration || 600),
      remaining: Number(body.remaining || 600),
      running: true,
      startedAt: Number(body.startedAt || Date.now()),
      updatedAt: Date.now(),
      notificationState: {
        lastScoreA: Number(body.scoreA || 0),
        lastScoreB: Number(body.scoreB || 0),
        notifiedEventIds: []
      }
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

    const prevScoreA = Number(current.scoreA ?? 0);
    const prevScoreB = Number(current.scoreB ?? 0);
    const prevEvents = Array.isArray(current.events) ? current.events : [];

    current.scoreA = Number(body.scoreA ?? current.scoreA ?? 0);
    current.scoreB = Number(body.scoreB ?? current.scoreB ?? 0);
    if (typeof body.teamALogoDataUrl !== 'undefined') current.teamALogoDataUrl = String(body.teamALogoDataUrl || '');
    if (typeof body.teamBLogoDataUrl !== 'undefined') current.teamBLogoDataUrl = String(body.teamBLogoDataUrl || '');
    if (Array.isArray(body.events)) current.events = body.events.slice(0, 200).map(normalizeLiveEvent);
    current.remaining = Number(body.remaining ?? current.remaining ?? 0);
    current.duration = Number(body.duration ?? current.duration ?? 600);
    if (typeof body.running !== 'undefined') current.running = Boolean(body.running);
    current.updatedAt = Date.now();

    await notifyLiveGameRealtime({
      previous: {
        scoreA: prevScoreA,
        scoreB: prevScoreB,
        events: prevEvents
      },
      current: current
    });

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
    if (typeof body.teamALogoDataUrl !== 'undefined') current.teamALogoDataUrl = String(body.teamALogoDataUrl || '');
    if (typeof body.teamBLogoDataUrl !== 'undefined') current.teamBLogoDataUrl = String(body.teamBLogoDataUrl || '');
    if (Array.isArray(body.events)) current.events = body.events.slice(0, 200).map(normalizeLiveEvent);
    current.remaining = Number(body.remaining ?? current.remaining ?? 0);
    current.running = false;
    current.endedAt = Date.now();
    current.updatedAt = Date.now();
    current.status = 'finished';

    const teamAId = String(current.teamAId || '');
    const teamBId = String(current.teamBId || '');
    const scoreA = Number(current.scoreA || 0);
    const scoreB = Number(current.scoreB || 0);
    const teamA = (tournament.teams || []).find((t) => String(t.id || '') === teamAId) || null;
    const teamB = (tournament.teams || []).find((t) => String(t.id || '') === teamBId) || null;

    function ensureStats(team) {
      if (!team) return null;
      const s = team.stats && typeof team.stats === 'object' ? team.stats : {};
      team.stats = {
        points: Number(s.points || 0),
        games: Number(s.games || 0),
        wins: Number(s.wins || 0),
        draws: Number(s.draws || 0),
        losses: Number(s.losses || 0),
        goalsPro: Number(s.goalsPro || 0),
        goalsContra: Number(s.goalsContra || 0),
        goalDiff: Number(s.goalDiff || 0)
      };
      return team.stats;
    }

    const statsA = ensureStats(teamA);
    const statsB = ensureStats(teamB);
    if (statsA && statsB) {
      statsA.games += 1;
      statsB.games += 1;
      statsA.goalsPro += scoreA;
      statsA.goalsContra += scoreB;
      statsB.goalsPro += scoreB;
      statsB.goalsContra += scoreA;

      if (scoreA > scoreB) {
        statsA.wins += 1;
        statsA.points += 3;
        statsB.losses += 1;
      } else if (scoreB > scoreA) {
        statsB.wins += 1;
        statsB.points += 3;
        statsA.losses += 1;
      } else {
        statsA.draws += 1;
        statsB.draws += 1;
        statsA.points += 1;
        statsB.points += 1;
      }

      statsA.goalDiff = Number(statsA.goalsPro || 0) - Number(statsA.goalsContra || 0);
      statsB.goalDiff = Number(statsB.goalsPro || 0) - Number(statsB.goalsContra || 0);
    }

    const goalEvents = (Array.isArray(current.events) ? current.events : [])
      .filter((ev) => String(ev?.type || '').toUpperCase() === 'GP')
      .map((ev) => ({
        playerId: String(ev.playerId || ''),
        playerName: String(ev.playerName || '')
      }));

    const matchId = uid();
    const matches = Array.isArray(tournament.matches) ? tournament.matches : [];
    matches.push({
      id: matchId,
      liveGameId: String(current.id || ''),
      teamAId,
      teamBId,
      goalsA: scoreA,
      goalsB: scoreB,
      stage: 'Ao vivo',
      date: new Date(current.endedAt).toISOString(),
      goalEvents,
      createdAt: Date.now()
    });
    tournament.matches = matches;

    const recent = Array.isArray(tournament.recentGames) ? tournament.recentGames : [];
    recent.unshift({ ...current, linkedMatchId: matchId });
    tournament.recentGames = recent.slice(0, 20);
    tournament.liveGame = null;

    await writeTournamentState(tournament);
    res.json({ ok: true, recentGame: current });
  } catch {
    res.status(500).json({ error: 'Falha ao encerrar jogo ao vivo' });
  }
});

function normalizeLiveEvent(evt = {}) {
  return {
    id: String(evt.id || uid()),
    type: String(evt.type || ''),
    side: String(evt.side || ''),
    playerId: String(evt.playerId || ''),
    playerName: String(evt.playerName || 'Jogador'),
    teamName: String(evt.teamName || ''),
    elapsed: Number(evt.elapsed || 0),
    minute: Number(evt.minute || 0),
    createdAt: Number(evt.createdAt || Date.now())
  };
}

function toStatNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getTopScorerId(players = []) {
  const list = Array.isArray(players) ? players : [];
  let best = null;
  for (const p of list) {
    const goals = Math.max(0, toStatNumber(p?.goals));
    if (goals <= 0) continue;
    if (!best) {
      best = { id: p.id, goals, name: String(p?.name || '') };
      continue;
    }
    if (goals > best.goals) {
      best = { id: p.id, goals, name: String(p?.name || '') };
      continue;
    }
    if (goals === best.goals) {
      const name = String(p?.name || '');
      if (name.localeCompare(best.name, 'pt-BR') < 0) {
        best = { id: p.id, goals, name };
      }
    }
  }
  return best && best.id ? String(best.id) : '';
}

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
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const section = String(req.query?.section || 'all').trim().toLowerCase();
  const isAll = !section || section === 'all';
  const needProfile = isAll || section === 'perfil';
  const needStandings = isAll || section === 'tabela';
  const needRanking = isAll || section === 'ranking';
  const needLive = isAll || section === 'ao-vivo';
  const needSchedule = isAll || section === 'temporada';
  const needRecent = isAll || section === 'jogos';
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
  const topScorerId = getTopScorerId(tournament.players || []);
  const teamsById = new Map((tournament.teams || []).map((t) => [t.id, t]));
  const teamStats = needProfile && team
    ? tournament.matches.reduce((acc, m) => {
        if (m.teamAId !== team.id && m.teamBId !== team.id) return acc;
        const isA = m.teamAId === team.id;
        acc.goalsFor += Number(isA ? m.goalsA : m.goalsB) || 0;
        acc.goalsAgainst += Number(isA ? m.goalsB : m.goalsA) || 0;
        return acc;
      }, { goalsFor: 0, goalsAgainst: 0 })
    : { goalsFor: 0, goalsAgainst: 0 };
  const teammates = needProfile && team
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
          isTopScorer: !!topScorerId && String(p.id) === String(topScorerId),
          photoDataUrl: p.photoDataUrl || '',
          isMe: p.id === player.id
        }))
    : [];

  function resolveTeamMeta(teamId, teamName) {
    if (teamId) {
      const byId = teamsById.get(teamId);
      if (byId) {
        return {
          name: String(byId.name || teamName || 'Time'),
          logoDataUrl: String(byId.logoDataUrl || '')
        };
      }
    }
    const byName = (tournament.teams || []).find((t) => String(t.name || '').trim().toLowerCase() === String(teamName || '').trim().toLowerCase());
    if (byName) {
      return {
        name: String(byName.name || teamName || 'Time'),
        logoDataUrl: String(byName.logoDataUrl || '')
      };
    }
    return {
      name: String(teamName || 'Time'),
      logoDataUrl: ''
    };
  }

  function resolveTeamLogo(teamId, teamName) {
    return resolveTeamMeta(teamId, teamName).logoDataUrl;
  }

  const liveGameRaw = needLive ? (tournament.liveGame || null) : null;
  const liveGame = liveGameRaw
    ? (() => {
        const a = resolveTeamMeta(liveGameRaw.teamAId, liveGameRaw.teamAName);
        const b = resolveTeamMeta(liveGameRaw.teamBId, liveGameRaw.teamBName);
        return {
          ...liveGameRaw,
          teamAName: a.name,
          teamBName: b.name,
          teamALogoDataUrl: a.logoDataUrl,
          teamBLogoDataUrl: b.logoDataUrl
        };
      })()
    : null;

  const recentGames = needRecent ? (Array.isArray(tournament.recentGames) ? tournament.recentGames : []).map((g) => {
    const a = resolveTeamMeta(g.teamAId, g.teamAName);
    const b = resolveTeamMeta(g.teamBId, g.teamBName);
    return {
      ...g,
      teamAName: a.name,
      teamBName: b.name,
      teamALogoDataUrl: a.logoDataUrl,
      teamBLogoDataUrl: b.logoDataUrl
    };
  }) : [];

  const standings = needStandings ? (tournament.teams || []).map((t) => {
    const s = t && t.stats && typeof t.stats === 'object' ? t.stats : {};
    return {
      id: t.id,
      name: t.name,
      color: t.color || '#0f766e',
      logoDataUrl: t.logoDataUrl || '',
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
  ) : [];

  const playerRanking = needRanking ? (tournament.players || [])
    .map((p) => {
      const goals = Math.max(0, toStatNumber(p.goals));
      const assists = Math.max(0, toStatNumber(p.assists));
      const yellowCards = Math.max(0, toStatNumber(p.yellowCards));
      const redCards = Math.max(0, toStatNumber(p.redCards));
      const rankingPoints = goals * 3 - yellowCards - redCards * 3;
      const rankingTeam = (tournament.teams || []).find((t) => t.id === p.teamId);
      return {
        id: p.id,
        name: p.name || 'Jogador',
        teamName: rankingTeam ? rankingTeam.name : 'Sem time',
        goals,
        assists,
        yellowCards,
        redCards,
        rankingPoints,
        isCaptain: Boolean(p.isCaptain),
        isTopScorer: !!topScorerId && String(p.id) === String(topScorerId)
      };
    })
    .sort((a, b) =>
      b.rankingPoints - a.rankingPoints ||
      b.goals - a.goals ||
      String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
    ) : [];

  const gameSchedule = needSchedule ? (Array.isArray(tournament.gameSchedule) ? tournament.gameSchedule : []).map((g) => {
    const aId = String(g.teamAId || '');
    const bId = String(g.teamBId || '');
    const teamAById = aId ? teamsById.get(aId) : null;
    const teamBById = bId ? teamsById.get(bId) : null;
    const aLabel = String((teamAById && teamAById.name) || g.teamALabel || '');
    const bLabel = String((teamBById && teamBById.name) || g.teamBLabel || '');
    return {
      ...g,
      teamALabel: aLabel,
      teamBLabel: bLabel,
      teamALogoDataUrl: resolveTeamLogo(aId, aLabel),
      teamBLogoDataUrl: resolveTeamLogo(bId, bLabel)
    };
  }) : [];

  const payload = {
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
      isTopScorer: !!topScorerId && String(player.id) === String(topScorerId),
      photoDataUrl: player.photoDataUrl || ''
    },
    team: team ? { id: team.id, name: team.name, color: team.color || '#0f766e', logoDataUrl: team.logoDataUrl || '' } : null
  };

  if (needProfile) {
    payload.teamStats = teamStats;
    payload.teammates = teammates;
  }
  if (needStandings) payload.standings = standings;
  if (needRanking) payload.playerRanking = playerRanking;
  if (needSchedule) payload.gameSchedule = gameSchedule;
  if (needLive) payload.liveGame = liveGame;
  if (needRecent) payload.recentGames = recentGames;

  res.json(payload);
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      subscription JSONB NOT NULL,
      created_at BIGINT NOT NULL,
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

function sanitizeEnvValue(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/[\r\n\t ]+/g, '');
}

function isPushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

function getMissingPushConfig() {
  const missing = [];
  if (!VAPID_PUBLIC_KEY) missing.push('VAPID_PUBLIC_KEY');
  if (!VAPID_PRIVATE_KEY) missing.push('VAPID_PRIVATE_KEY');
  return missing;
}

function pushConfigErrorMessage() {
  const missing = getMissingPushConfig();
  return missing.length
    ? `Push nao configurado no servidor. Faltando: ${missing.join(', ')}`
    : 'Push nao configurado no servidor';
}

async function sendPushNotification(payload, userId = null) {
  const values = [];
  let sql = `
    SELECT DISTINCT ON (user_id) endpoint, user_id, subscription, updated_at
    FROM push_subscriptions
  `;
  if (userId) {
    values.push(userId);
    sql += ' WHERE user_id = $1';
  }
  sql += ' ORDER BY user_id, updated_at DESC';
  const result = await pool.query(sql, values);
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const total = rows.length;
  let sent = 0;
  let removed = 0;
  let failed = 0;
  const failures = [];

  await Promise.all(rows.map(async (row) => {
    try {
      const subscription = row.subscription && typeof row.subscription === 'object'
        ? row.subscription
        : JSON.parse(String(row.subscription || '{}'));
      await sendPushWithTimeout(subscription, JSON.stringify(payload), 8000);
      sent += 1;
    } catch (err) {
      const status = Number(err?.statusCode || 0);
      failed += 1;
      const rawBody = err && typeof err.body !== 'undefined' ? String(err.body || '') : '';
      failures.push({
        endpoint: String(row.endpoint || ''),
        status: status || 0,
        message: String(err?.message || 'erro no envio'),
        body: rawBody.slice(0, 220)
      });
      if (status === 404 || status === 410) {
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [String(row.endpoint || '')]);
        removed += 1;
      }
    }
  }));

  return { total, sent, removed, failed, failures: failures.slice(0, 10) };
}

async function sendPushWithTimeout(subscription, payload, timeoutMs) {
  const timeout = Number(timeoutMs || 8000);
  return Promise.race([
    webpush.sendNotification(subscription, payload),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Push timeout após ${timeout}ms`)), timeout);
    })
  ]);
}

async function notifyLiveGameRealtime({ previous, current }) {
  if (!isPushConfigured()) return;
  if (!current || typeof current !== 'object') return;
  const prev = previous && typeof previous === 'object' ? previous : {};
  const prevScoreA = Number(prev.scoreA || 0);
  const prevScoreB = Number(prev.scoreB || 0);
  const nextScoreA = Number(current.scoreA || 0);
  const nextScoreB = Number(current.scoreB || 0);
  const teamA = String(current.teamAName || 'Time A');
  const teamB = String(current.teamBName || 'Time B');

  const state = current.notificationState && typeof current.notificationState === 'object'
    ? current.notificationState
    : { lastScoreA: prevScoreA, lastScoreB: prevScoreB, notifiedEventIds: [] };
  const notified = new Set(Array.isArray(state.notifiedEventIds) ? state.notifiedEventIds.map((id) => String(id || '')) : []);
  const events = Array.isArray(current.events) ? current.events : [];
  const freshGoalEvents = events.filter((evt) => {
    const id = String(evt?.id || '');
    const type = String(evt?.type || '').toUpperCase();
    if (!id || (type !== 'GP' && type !== 'GC')) return false;
    if (notified.has(id)) return false;
    return true;
  }).slice(0, 10);

  for (const evt of freshGoalEvents) {
    const type = String(evt?.type || '').toUpperCase();
    const playerName = String(evt?.playerName || 'Jogador');
    const isOwnGoal = type === 'GC';
    const goalLabel = isOwnGoal ? `(C) ${playerName}` : playerName;
    const eventKey = `evt:${String(current.id || '')}:${String(evt.id || '')}`;
    if (!isRecentlyNotified(eventKey, 60000)) {
      markNotified(eventKey);
      await sendPushNotification({
        title: 'Gol na partida',
        body: `${teamA} ${nextScoreA} x ${nextScoreB} ${teamB}\nGol: ${goalLabel}`,
        url: '/player/home'
      }).catch(() => {});
    }
    notified.add(String(evt.id || ''));
  }

  const lastNotifiedScoreA = Number(state.lastScoreA || 0);
  const lastNotifiedScoreB = Number(state.lastScoreB || 0);
  const scoreChanged = nextScoreA > lastNotifiedScoreA || nextScoreB > lastNotifiedScoreB;
  // Fallback para placar alterado sem evento de gol (ex.: gol manual +/-).
  if (scoreChanged && !freshGoalEvents.length) {
    const scoreKey = `score:${String(current.id || '')}:${nextScoreA}x${nextScoreB}`;
    if (!isRecentlyNotified(scoreKey, 25000)) {
      markNotified(scoreKey);
      await sendPushNotification({
        title: 'Gol na partida',
        body: `${teamA} ${nextScoreA} x ${nextScoreB} ${teamB}`,
        url: '/player/home'
      }).catch(() => {});
    }
  }
  state.lastScoreA = Math.max(lastNotifiedScoreA, nextScoreA);
  state.lastScoreB = Math.max(lastNotifiedScoreB, nextScoreB);
  const freshCardEvents = events.filter((evt) => {
    const id = String(evt?.id || '');
    const type = String(evt?.type || '').toUpperCase();
    if (!id || (type !== 'CA' && type !== 'CV')) return false;
    if (notified.has(id)) return false;
    return true;
  }).slice(0, 10);

  for (const evt of freshCardEvents) {
    const type = String(evt?.type || '').toUpperCase();
    const side = String(evt?.side || '').toUpperCase();
    const team = side === 'B' ? teamB : teamA;
    const playerName = String(evt?.playerName || 'Jogador');
    const isYellow = type === 'CA';
    const title = isYellow ? 'Cartao amarelo' : 'Cartao vermelho';
    const body = `${title} ${team}: ${playerName}`;
    const eventKey = `evt:${String(current.id || '')}:${String(evt.id || '')}`;
    if (!isRecentlyNotified(eventKey, 60000)) {
      // Marca antes de enviar para evitar duplicidade em updates concorrentes.
      markNotified(eventKey);
      await sendPushNotification({
        title,
        body,
        url: '/player/home'
      }).catch(() => {});
    }
    notified.add(String(evt.id || ''));
  }

  state.notifiedEventIds = Array.from(notified).slice(-300);
  current.notificationState = state;
}

function isRecentlyNotified(key, ttlMs) {
  cleanupLivePushDedup();
  const ts = Number(livePushDedup.get(String(key)) || 0);
  if (!ts) return false;
  return (Date.now() - ts) < Number(ttlMs || 0);
}

function markNotified(key) {
  livePushDedup.set(String(key), Date.now());
  cleanupLivePushDedup();
}

function cleanupLivePushDedup() {
  const now = Date.now();
  if (livePushDedup.size > 2500) {
    for (const [k, ts] of livePushDedup.entries()) {
      if (now - Number(ts || 0) > 5 * 60 * 1000) livePushDedup.delete(k);
    }
    return;
  }
  for (const [k, ts] of livePushDedup.entries()) {
    if (now - Number(ts || 0) > 2 * 60 * 1000) livePushDedup.delete(k);
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
