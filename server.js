import express from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'troque-essa-chave-no-easypanel';
const dataDir = path.join(__dirname, 'data');
const storePath = path.join(dataDir, 'store.json');

fs.mkdirSync(dataDir, { recursive: true });

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true }));

function defaultTournament() {
  return { teams: [], players: [], matches: [], bracket: [] };
}

function defaultStore() {
  return { users: [], tournament: defaultTournament(), meta: { lastUpdatedAt: Date.now() } };
}

function readStore() {
  if (!fs.existsSync(storePath)) {
    const seed = defaultStore();
    fs.writeFileSync(storePath, JSON.stringify(seed, null, 2));
    return seed;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      tournament: normalizeTournament(parsed.tournament),
      meta: parsed.meta && typeof parsed.meta === 'object' ? parsed.meta : { lastUpdatedAt: Date.now() }
    };
  } catch {
    const seed = defaultStore();
    fs.writeFileSync(storePath, JSON.stringify(seed, null, 2));
    return seed;
  }
}

function writeStore(store) {
  store.meta = { ...(store.meta || {}), lastUpdatedAt: Date.now() };
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function normalizeTournament(input) {
  const base = defaultTournament();
  const t = input && typeof input === 'object' ? input : {};
  return {
    teams: Array.isArray(t.teams) ? t.teams : base.teams,
    players: Array.isArray(t.players) ? t.players : base.players,
    matches: Array.isArray(t.matches) ? t.matches : base.matches,
    bracket: Array.isArray(t.bracket) ? t.bracket : base.bracket
  };
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
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
  if (!expected) {
    return next();
  }
  const token = req.headers['x-admin-token'];
  if (token !== expected) {
    return res.status(401).json({ error: 'Admin token invalido' });
  }
  next();
}

app.get('/api/health', (_req, res) => res.json({ ok: true, date: new Date().toISOString() }));

app.post('/api/auth/register', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (!name || !email || !password) return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios' });
  if (password.length < 4) return res.status(400).json({ error: 'Senha deve ter pelo menos 4 caracteres' });

  const store = readStore();
  const exists = store.users.some((u) => u.email === email);
  if (exists) return res.status(409).json({ error: 'Email ja cadastrado' });

  const user = {
    id: uid(),
    name,
    email,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: Date.now()
  };
  store.users.push(user);
  writeStore(store);

  const token = issueToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const store = readStore();
  const user = store.users.find((u) => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email ou senha invalidos' });
  }
  const token = issueToken(user);
  res.json({ token, user: publicUser(user) });
});

app.get('/api/auth/me', authRequired, (req, res) => {
  const store = readStore();
  const user = store.users.find((u) => u.id === req.auth.sub);
  if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });
  res.json({ user: publicUser(user) });
});

app.get('/api/users', adminRequired, (_req, res) => {
  const store = readStore();
  res.json({ users: store.users.map(publicUser) });
});

app.get('/api/state', adminRequired, (_req, res) => {
  const store = readStore();
  res.json({ tournament: normalizeTournament(store.tournament) });
});

app.put('/api/state', adminRequired, (req, res) => {
  const incoming = normalizeTournament(req.body?.tournament);
  const store = readStore();

  // Keep player structure compatible and allow linked auth user via userId.
  incoming.players = incoming.players.map((p) => ({
    ...p,
    userId: p.userId || ''
  }));

  store.tournament = incoming;
  writeStore(store);
  res.json({ ok: true, tournament: store.tournament, updatedAt: store.meta.lastUpdatedAt });
});

app.get('/api/player/home', authRequired, (req, res) => {
  const store = readStore();
  const user = store.users.find((u) => u.id === req.auth.sub);
  if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' });

  const tournament = normalizeTournament(store.tournament);
  const player = tournament.players.find((p) => p.userId === user.id);

  if (!player) {
    return res.json({
      user: publicUser(user),
      linked: false,
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

app.get('/player', (_req, res) => {
  res.sendFile(path.join(__dirname, 'player.html'));
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Resenha Ferreira rodando na porta ${PORT}`);
});

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
