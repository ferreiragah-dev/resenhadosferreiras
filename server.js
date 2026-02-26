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
  return { teams: [], players: [], matches: [], bracket: [], settings: { eventStartAt: '' } };
}

function normalizeTournament(input) {
  const base = defaultTournament();
  const t = input && typeof input === 'object' ? input : {};
  return {
    teams: Array.isArray(t.teams) ? t.teams : base.teams,
    players: Array.isArray(t.players) ? t.players.map((p) => ({ ...p, userId: p?.userId || '' })) : base.players,
    matches: Array.isArray(t.matches) ? t.matches : base.matches,
    bracket: Array.isArray(t.bracket) ? t.bracket : base.bracket,
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

app.get('/api/state', adminRequired, async (_req, res) => {
  res.json({ tournament: await readTournamentState() });
});

app.put('/api/state', adminRequired, async (req, res) => {
  const tournament = await writeTournamentState(req.body?.tournament);
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
          isMe: p.id === player.id
        }))
    : [];

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
      photoDataUrl: player.photoDataUrl || ''
    },
    team: team ? { id: team.id, name: team.name, color: team.color || '#0f766e' } : null,
    teammates
  });
});

app.use(express.static(__dirname, { extensions: ['html'] }));
app.get('/player', (_req, res) => res.sendFile(path.join(__dirname, 'player.html')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

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
