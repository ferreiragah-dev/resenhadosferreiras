# Resenha dos Ferreira - Campeonato (PWA + Area do Jogador)

## O que tem

- PWA de campeonato (admin): cadastro de times, jogadores, penalidades, placar, chaveamento e ranking
- Area mobile do jogador (`/player`): cadastro, login e tela home
- Sincronizacao com backend (Postgres via `DATABASE_URL`)

## Fluxo dos jogadores

1. Jogador acessa `/player`
2. Faz cadastro com `nome`, `email` e `senha`
3. No PWA admin (`/`), no cadastro de jogador, selecione a conta no campo `Vincular conta do jogador`
4. Quando o jogador estiver em um time, ele vera na home:
   - Seu time
   - Seus cartoes
   - Cartoes/gols dos companheiros do mesmo time

## Rodar localmente

```bash
npm install
npm start
```

App sobe em `http://localhost:3000`

## Deploy no EasyPanel (Node app)

Crie um app Node.js apontando para este repositorio.

- Start command: `npm start`
- Port: `3000`

Variaveis recomendadas:

- `PORT=3000`
- `JWT_SECRET=coloque-uma-chave-forte-aqui`
- `VAPID_PUBLIC_KEY=...`
- `VAPID_PRIVATE_KEY=...`
- `VAPID_SUBJECT=mailto:seu-email@dominio.com`

Opcional (proteger APIs admin):

- `ADMIN_TOKEN=um-token-admin`

Observacao:

- Se voce configurar `ADMIN_TOKEN`, o PWA admin atual precisara enviar esse header (`x-admin-token`). Nesta versao, deixe sem `ADMIN_TOKEN` para funcionar direto.

## Push no celular (PWA)

Requisitos:

- Dominio com HTTPS valido
- PWA instalado no celular
- Permissao de notificacao concedida
- Chaves VAPID configuradas no backend

Gerar chaves VAPID:

```bash
npx web-push generate-vapid-keys
```

Configurar no EasyPanel:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (ex: `mailto:admin@seudominio.com`)

Endpoints de push:

- `GET /api/push/public-key` (auth do jogador)
- `POST /api/push/subscribe` (auth do jogador)
- `POST /api/push/unsubscribe` (auth do jogador)
- `POST /api/push/test` (admin) body exemplo:

```json
{
  "title": "Teste da Resenha",
  "body": "Notificacao funcionando no celular.",
  "url": "/player/home"
}
```

## Persistencia

- Dados principais ficam no Postgres configurado via `DATABASE_URL`
- O arquivo `data/store.json` legado (se existir) pode ser migrado automaticamente na primeira subida

## Deploy no EasyPanel (Container direto)

Use este `Dockerfile` do projeto.

- Build context: raiz do projeto
- Porta exposta: `3000`
- Variaveis:
  - `PORT=3000`
  - `JWT_SECRET=coloque-uma-chave-forte-aqui`
  - `DATABASE_URL=postgres://...` (use a URL interna do Postgres no EasyPanel)
  - `ADMIN_TOKEN` (opcional)

Observacoes:

- O backend migra automaticamente `data/store.json` antigo para Postgres na primeira subida (se o banco estiver vazio).
- Se o EasyPanel usar healthcheck, pode apontar para `/api/health`.
