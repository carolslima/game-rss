# 🎮 Game RSS — Motor Multi-Jogos de Feeds RSS

> Gera feeds RSS 2.0 a partir de APIs e feeds oficiais de publishers de jogos.
> Com notificações no Discord quando há novidades.

[![Update RSS Feeds](https://github.com/carolslima/game-rss/actions/workflows/update-rss.yml/badge.svg)](https://github.com/carolslima/game-rss/actions/workflows/update-rss.yml)
[![Deploy to GitHub Pages](https://github.com/carolslima/game-rss/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/carolslima/game-rss/actions/workflows/deploy-pages.yml)

---

## 📡 Feeds Disponíveis

| Jogo | Publisher | Feed RSS | Idioma | Fonte |
|------|-----------|----------|--------|-------|
| **inZOI** | KRAFTON | [`inzoi.xml`](https://carolslima.github.io/game-rss/inzoi.xml) | 🇧🇷 pt-br | API oficial (`api-foc.krafton.com`) |
| **The Sims** | EA | [`thesims.xml`](https://carolslima.github.io/game-rss/thesims.xml) | 🇧🇷 pt-br | Site oficial (`ea.com/pt-br`) |
| **Paralives** | Paralives Studio | [`paralives.xml`](https://carolslima.github.io/game-rss/paralives.xml) | 🇧🇷 pt-br | Site oficial + tradução automática |
| **Carol Gamer** | Blog | [`carolgamer.xml`](https://carolslima.github.io/game-rss/carolgamer.xml) | 🇧🇷 pt-br | RSS Blogger (`carolgamer.com`) |

> \* Paralives: feed do site oficial Squarespace, conteúdo original em inglês (estúdio indie não publica em pt-br).

🔗 **URL base:** `https://carolslima.github.io/game-rss/`

Adicione qualquer uma dessas URLs no seu leitor RSS favorito (Feedly, Inoreader, Thunderbird, FreshRSS, etc.).

---

## 🏗️ Arquitetura

```
config/sources/*.json     → Configuração de cada jogo (fonte, feed meta, Discord)
lib/source-adapters/*.js  → Adaptadores: busca e normalização de posts
lib/orchestrator.js       → Entry point: loop sobre sources, gera RSS, notifica
lib/rss-generator.js      → Gerador RSS 2.0 genérico (feedMeta + posts → XML)
lib/history.js            → Histórico JSON por jogo (deduplicação, merge)
lib/discord.js            → Notificador Discord via webhook (embeds)
lib/fetch-utils.js        → Fetch HTTP com timeout, retry e backoff exponencial
lib/translate.js          → Tradução automática gratuita (en → pt-br)
lib/xml-utils.js          → Escape XML, CDATA, enclosure tag
```

### Fluxo

```
Cron (30min) / Manual / Push
        │
        ▼
  orchestrator.js
        │
        ├─→ inZOI       → API KRAFTON (HAL+JSON, auto-descoberta)  → inzoi.xml
        ├─→ The Sims  → ea.com/pt-br (extração JSON do HTML)     → thesims.xml
        ├─→ Paralives   → paralives.com/news (Squarespace RSS)         → paralives.xml
        └─→ Carol Gamer → RSS Blogger (100% pt-br)                  → carolgamer.xml
        │
        ▼
  GitHub Pages (Actions deploy)
        │
        ▼
  Discord (webhook por jogo, opcional, só quando há posts novos)
```

### Como o Discord é notificado

```
API/Fonte → fetchPosts() → mergeHistory()
                               │
                               ├─ Posts já conhecidos? → ignora
                               └─ Posts NOVOS? → newPosts[]
                                                   │
                                                   └─ Se newPosts > 0:
                                                      discord.send(webhook, newPosts)
                                                      (máximo 5 embeds)
```

**Garantias:**
- Só notifica posts **realmente novos** (deduplicação por ID/link)
- Máximo **5 notificações por execução** (evita spam no first run)
- **Nunca notifica no primeiro deploy** (histórico já existe versionado)
- Falha no Discord **nunca interrompe** a geração dos RSS

---

## 🔧 Como Funciona Cada Fonte

### inZOI (KRAFTON)

API HAL+JSON com autenticação por headers `service-namespace` e `service-game`.
**Auto-descoberta:** faz fetch em `playinzoi.com`, extrai os valores do HTML com regex.
Zero configuração manual. Fallback no config JSON se o site estiver offline.

### The Sims (EA)

O site `ea.com/pt-br/games/the-sims/news` (Next.js) tem os artigos em JSON embutido
no HTML. O adaptador extrai com regex. Títulos e resumos em **português brasileiro**.
Fallback para Steam RSS se a extração falhar.

### Paralives (Paralives Studio)

Feed RSS nativo do Squarespace em `paralives.com/news?format=rss`.
Conteúdo original em inglês, **traduzido automaticamente para pt-br** via Google Translate
(endpoint gratuito, sem API key). O módulo `lib/translate.js` gerencia a tradução
com quebra de textos longos e delay entre requisições.

### Carol Gamer (Blogger)

Feed RSS nativo do Blogger em `carolgamer.com/feeds/posts/default?alt=rss`.
Conteúdo **100% em português brasileiro** sobre The Sims, inZOI e Paralives.

---

## 🚀 Adicionar um Novo Jogo

1. **Crie o arquivo de configuração** em `config/sources/`:

```json
{
  "id": "meu-jogo",
  "name": "Meu Jogo",
  "publisher": "Publisher",
  "adapter": "meu-jogo",
  "enabled": true,
  "outputFile": "meujogo.xml",
  "feedMeta": {
    "title": "Meu Jogo — Notícias (pt-br)",
    "description": "Últimas notícias do Meu Jogo para a comunidade brasileira.",
    "link": "https://meujogo.com/news",
    "language": "pt-br",
    "feedUrl": "https://carolslima.github.io/game-rss/meujogo.xml"
  },
  "history": { "maxPosts": 200 },
  "fetch": { "timeoutMs": 30000, "maxRetries": 3, "retryBaseDelayMs": 1000 },
  "discord": {
    "webhookSecretName": "DISCORD_WEBHOOK_MEUJOGO",
    "color": 5793266
  },
  "options": {
    "rssFeedUrl": "https://meujogo.com/feed"
  }
}
```

2. **(Opcional) Crie um adaptador** em `lib/source-adapters/meu-jogo.js`.
   - Se for RSS/Atom padrão, pode reaproveitar o parser `steam-rss.js` ou `carolgamer.js`
   - Se for API customizada, implemente `export default async function fetchPosts(config, context)`
   - **Interface do adaptador:**
     ```js
     export default async function fetchPosts(config, context) {
       // config = JSON completo da source
       // context = { fetchWithRetry, log, sleep, env }
       // retorna Array<NormalizedPost>
     }
     ```

3. **Pronto!** O orquestrador descobre automaticamente pelo diretório `config/sources/`.

### Formatos comuns

| Fonte | Adaptador de exemplo | Usado por |
|-------|---------------------|-----------|
| Steam RSS | `steam-rss.js` (parser) | The Sims (fallback) |
| Squarespace RSS | `paralives.js` (parser) | Paralives |
| Blogger RSS | `carolgamer.js` (parser) | Carol Gamer |
| API REST/HAL+JSON | `krafton-inzoi.js` (custom) | inZOI (KRAFTON) |
| Site com JSON embutido | `ea-thesims.js` (custom) | The Sims (EA) |

---

## 🔔 Discord

### Configuração:

1. No servidor Discord: **Configurações → Integrações → Webhooks → Novo Webhook**
2. Escolha o canal e copie a URL gerada
3. No GitHub: **Settings → Secrets and variables → Actions → New secret**:

| Secret | Canal sugerido |
|--------|---------------|
| `DISCORD_WEBHOOK_INZOI` | `#inzoi-news` |
| `DISCORD_WEBHOOK_SIMS` | `#the-sims-news` |
| `DISCORD_WEBHOOK_PARALIVES` | `#paralives-news` |
| `DISCORD_WEBHOOK_CAROLGAMER` | `#carol-gamer` |

4. O campo `discord.webhookSecretName` no config JSON faz a ligação

**Features:**
- Embeds ricos com thumbnail, link, categoria e data
- Máximo 5 notificações por execução (evita spam)
- Falha no Discord **nunca** interrompe a geração dos RSS
- **Não notifica no primeiro deploy** (histórico versionado no git)

---

## 🛠️ Desenvolvimento

### Requisitos
- **Node.js >= 22** (usa `fetch` nativo e ESM)
- **Zero dependências npm** — tudo resolvido com a stdlib do Node

### Executar localmente

```bash
# Gerar todos os RSS (4 fontes)
node lib/orchestrator.js

# Ou via npm
npm run generate
```

### Estrutura de diretórios

```
game-rss/
├── .github/workflows/
│   ├── update-rss.yml        # CI: gera RSS, commita mudanças
│   └── deploy-pages.yml      # CD: deploy public/ → GitHub Pages
├── config/sources/            # Config JSON por jogo
│   ├── krafton-inzoi.json
│   ├── ea-thesims.json
│   ├── paralives.json
│   └── carolgamer.json
├── lib/
│   ├── orchestrator.js        # Entry point
│   ├── rss-generator.js       # Gerador RSS 2.0 genérico
│   ├── history.js             # Histórico JSON com deduplicação
│   ├── discord.js             # Notificador Discord (webhook embeds)
│   ├── fetch-utils.js         # Fetch com timeout, retry, backoff
│   ├── translate.js           # Tradução automática en → pt-br
│   ├── xml-utils.js           # escapeXml, cdata, enclosure
│   └── source-adapters/
│       ├── steam-rss.js       # Parser compartilhado de RSS Steam
│       ├── krafton-inzoi.js   # API KRAFTON HAL+JSON
│       ├── ea-thesims.js     # EA pt-br (extração JSON do HTML)
│       ├── paralives.js       # Squarespace RSS → NormalizedPost
│       └── carolgamer.js      # Blogger RSS → NormalizedPost
├── data/                      # Histórico por jogo (versionado no git)
│   ├── krafton-inzoi.json
│   ├── ea-thesims.json
│   ├── paralives.json
│   └── carolgamer.json
├── public/                    # Servido via GitHub Pages
│   ├── index.html             # Listagem dos feeds
│   ├── inzoi.xml
│   ├── thesims.xml
│   ├── paralives.xml
│   └── carolgamer.xml
├── package.json
├── PLAN.md                    # Planejamento detalhado
└── README.md
```

---

## 🚢 Deploy no GitHub — Passo a Passo

### 1. Criar o repositório

```bash
# No terminal, dentro da pasta do projeto:
git add -A
git commit -m "feat: game-rss v2 — inZOI, Sims 4, Paralives, Carol Gamer + Discord"

# Criar repo vazio no GitHub (https://github.com/new)
# Nome: game-rss — NÃO marcar "Add README"

git remote add origin https://github.com/carolslima/game-rss.git
git push -u origin main
```

### 2. Configurar GitHub Pages

- **Settings → Pages**
- Source: **GitHub Actions**

### 3. Configurar permissões dos workflows

- **Settings → Actions → General**
- Workflow permissions: **Read and write permissions**
- Marcar: **Allow GitHub Actions to create and approve pull requests**

### 4. Adicionar secrets do Discord (opcional)

- **Settings → Secrets and variables → Actions → New repository secret**
- Adicionar `DISCORD_WEBHOOK_INZOI`, `DISCORD_WEBHOOK_SIMS`, `DISCORD_WEBHOOK_PARALIVES`, `DISCORD_WEBHOOK_CAROLGAMER`

### 5. Primeiro teste

- **Actions → Update RSS Feeds → Run workflow**
- Verificar: `https://carolslima.github.io/game-rss/inzoi.xml`

---

## 📋 Secrets do GitHub

Apenas as secrets do Discord são necessárias (totalmente opcionais):

| Secret | Descrição |
|--------|-----------|
| `DISCORD_WEBHOOK_INZOI` | Webhook URL do canal inZOI |
| `DISCORD_WEBHOOK_SIMS` | Webhook URL do canal The Sims |
| `DISCORD_WEBHOOK_PARALIVES` | Webhook URL do canal Paralives |
| `DISCORD_WEBHOOK_CAROLGAMER` | Webhook URL do canal Carol Gamer |

> A autenticação da API KRAFTON (`namespace` e `game`) é resolvida automaticamente via auto-descoberta — **não requer secrets**.

---

## 📄 Licença

MIT — use, modifique e adapte como quiser.

---

**Mantenedor:** [@carolslima](https://github.com/carolslima)
**Repositório:** [github.com/carolslima/game-rss](https://github.com/carolslima/game-rss)
