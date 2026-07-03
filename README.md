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
| **The Sims 4** | EA | [`thesims4.xml`](https://carolslima.github.io/game-rss/thesims4.xml) | 🇧🇷 pt-br | Site oficial (`ea.com/pt-br`) |
| **Paralives** | Paralives Studio | [`paralives.xml`](https://carolslima.github.io/game-rss/paralives.xml) | 🇧🇷 pt-br * | Steam RSS (`store.steampowered.com`) |

> \* Paralives: metadados em pt-br, conteúdo original em inglês (estúdio indie publica apenas nesse idioma).

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
        ├─→ The Sims 4  → ea.com/pt-br (extração JSON do HTML)     → thesims4.xml
        └─→ Paralives   → Steam RSS feed                            → paralives.xml
        │
        ▼
  GitHub Pages (Actions deploy)
        │
        ▼
  Discord (webhook por jogo, opcional)
```

---

## 🔧 Como Funciona Cada Fonte

### inZOI (KRAFTON)

A API da KRAFTON usa um API Gateway que requer headers `service-namespace` e `service-game` para autenticação. Esses valores mudam a cada deploy do site.

**O adaptador resolve automaticamente:** faz fetch em `playinzoi.com/pt-br/news`, extrai os valores do HTML com regex, e usa na chamada da API. Zero configuração manual.

Se a auto-descoberta falhar, o fallback está no config:

```json
// config/sources/krafton-inzoi.json
"options": {
  "namespaceFallback": "inZOI_Official-24ea",
  "gameFallback": "inzoi"
}
```

### The Sims 4 (EA)

O site `ea.com/pt-br/games/the-sims/news` é uma app Next.js com os dados dos artigos em JSON embutido no HTML. O adaptador extrai esse JSON com regex e normaliza os campos (título, resumo, data, imagem, slug).

**Títulos e resumos em português brasileiro.** Se a extração falhar, faz fallback para o Steam RSS.

### Paralives (Paralives Studio)

Feed RSS do Steam com parâmetro `?l=brazilian` para metadados em pt-br. O estúdio publica apenas em inglês, então o conteúdo dos posts fica no idioma original.

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
   - Se for RSS/Atom padrão, pode reaproveitar o parser `steam-rss.js`
   - Se for API customizada, implemente `export default async function fetchPosts(config, context)`

3. **Pronto!** O orquestrador descobre automaticamente pelo diretório `config/sources/`.

### Formatos comuns

| Fonte | Adaptador | Exemplo |
|-------|-----------|---------|
| Steam RSS | `steam-rss.js` (parser) + adaptador fino | The Sims 4 (fallback), Paralives |
| API REST/HAL+JSON | Adaptador customizado | inZOI (KRAFTON) |
| Site com JSON embutido | Adaptador customizado com regex | The Sims 4 (EA) |
| RSS/Atom WordPress | Pode estender `steam-rss.js` | — |

---

## 🔔 Discord

Cada jogo pode notificar um canal diferente no Discord via webhook.

### Configuração:

1. No servidor Discord: **Configurações → Integrações → Webhooks → Novo Webhook**
2. Escolha o canal e copie a URL gerada
3. No GitHub: **Settings → Secrets and variables → Actions → New secret**:
   - `DISCORD_WEBHOOK_INZOI`
   - `DISCORD_WEBHOOK_SIMS4`
   - `DISCORD_WEBHOOK_PARALIVES`
4. O campo `discord.webhookSecretName` no config JSON faz a ligação

**Features:**
- Embeds ricos com thumbnail, link, categoria e data
- Máximo 5 notificações por execução (evita spam no first run)
- Falha no Discord **nunca** interrompe a geração dos RSS

---

## 🛠️ Desenvolvimento

### Requisitos
- **Node.js >= 22** (usa `fetch` nativo e ESM)
- **Zero dependências npm** — tudo resolvido com a stdlib do Node

### Executar localmente

```bash
# Gerar todos os RSS (3 fontes)
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
│   ├── ea-thesims4.json
│   └── paralives.json
├── lib/
│   ├── orchestrator.js        # Entry point
│   ├── rss-generator.js       # Gerador RSS 2.0 genérico
│   ├── history.js             # Histórico JSON com deduplicação
│   ├── discord.js             # Notificador Discord (webhook embeds)
│   ├── fetch-utils.js         # Fetch com timeout, retry, backoff
│   ├── xml-utils.js           # escapeXml, cdata, enclosure
│   └── source-adapters/
│       ├── steam-rss.js       # Parser compartilhado de RSS Steam
│       ├── krafton-inzoi.js   # API KRAFTON HAL+JSON
│       ├── ea-thesims4.js     # EA pt-br (extração JSON do HTML)
│       └── paralives.js       # Steam RSS → NormalizedPost
├── data/                      # Histórico por jogo (versionado no git)
│   ├── krafton-inzoi.json
│   ├── ea-thesims4.json
│   └── paralives.json
├── public/                    # Servido via GitHub Pages
│   ├── index.html             # Listagem dos feeds
│   ├── inzoi.xml
│   ├── thesims4.xml
│   └── paralives.xml
├── package.json
├── PLAN.md                    # Planejamento detalhado
└── README.md
```

---

## 📋 Secrets do GitHub

Apenas as secrets do Discord são necessárias (e são opcionais — se não configuradas, o feed funciona normalmente, só não notifica):

| Secret | Descrição |
|--------|-----------|
| `DISCORD_WEBHOOK_INZOI` | Webhook URL do canal inZOI no Discord |
| `DISCORD_WEBHOOK_SIMS4` | Webhook URL do canal The Sims 4 no Discord |
| `DISCORD_WEBHOOK_PARALIVES` | Webhook URL do canal Paralives no Discord |

> A autenticação da API KRAFTON (`namespace` e `game`) é resolvida automaticamente via auto-descoberta — **não requer secrets**.

---

## 📄 Licença

MIT — use, modifique e adapte como quiser.

---

**Mantenedor:** [@carolslima](https://github.com/carolslima)
**Repositório:** [github.com/carolslima/game-rss](https://github.com/carolslima/game-rss)
