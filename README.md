# 🎮 Game RSS — Motor Multi-Jogos de Feeds RSS

> Gera feeds RSS 2.0 a partir de APIs e feeds oficiais de publishers de jogos.
> Com notificações no Discord quando há novidades.

[![Update RSS Feeds](https://github.com/carolslima/game-rss/actions/workflows/update-rss.yml/badge.svg)](https://github.com/carolslima/game-rss/actions/workflows/update-rss.yml)
[![Deploy to GitHub Pages](https://github.com/carolslima/game-rss/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/carolslima/game-rss/actions/workflows/deploy-pages.yml)

---

## 📡 Feeds Disponíveis

| Jogo | Publisher | Feed RSS | Idioma |
|------|-----------|----------|--------|
| **inZOI** | KRAFTON | [`inzoi.xml`](https://carolslima.github.io/game-rss/inzoi.xml) | 🇧🇷 pt-br |
| **The Sims 4** | EA | [`thesims4.xml`](https://carolslima.github.io/game-rss/thesims4.xml) | 🇺🇸 en (jogo tem pt-br) |
| **Paralives** | Paralives Studio | [`paralives.xml`](https://carolslima.github.io/game-rss/paralives.xml) | 🇺🇸 en (jogo tem pt-br) |

🔗 **URL base:** `https://carolslima.github.io/game-rss/`

Adicione qualquer uma dessas URLs no seu leitor RSS favorito (Feedly, Inoreader, Thunderbird, FreshRSS, etc.).

---

## 🏗️ Arquitetura

```
config/sources/*.json     → Configuração de cada jogo (API, feed meta, Discord)
lib/source-adapters/*.js  → Adaptadores que buscam e normalizam posts
lib/orchestrator.js       → Orquestrador: loop sobre sources, gera RSS, notifica
lib/rss-generator.js      → Gerador de RSS 2.0 genérico
lib/history.js            → Gerenciador de histórico JSON por jogo
lib/discord.js            → Notificador Discord via webhook
lib/fetch-utils.js        → Fetch com timeout, retry e backoff
lib/xml-utils.js          → Escape XML, CDATA, enclosure
```

### Fluxo

```
Cron (30min) / Manual / Push
        │
        ▼
  orchestrator.js
        │
        ├─→ inZOI (API HAL+JSON)    → data/, public/inzoi.xml    → Discord #inzoi
        ├─→ The Sims 4 (Steam RSS)  → data/, public/thesims4.xml → Discord #the-sims
        └─→ Paralives (Steam RSS)   → data/, public/paralives.xml→ Discord #paralives
        │
        ▼
  GitHub Pages (Actions deploy)
```

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
    "title": "Meu Jogo News",
    "description": "Últimas notícias do Meu Jogo.",
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

2. **(Opcional) Crie um adaptador** em `lib/source-adapters/meu-jogo.js` se a API tiver formato customizado.

3. **Pronto!** O orquestrador descobre automaticamente.

### Formatos suportados sem adaptador customizado:
- **Steam RSS** — use o adaptador compartilhado `steam-rss.js`
- **RSS/Atom padrão** — pode estender o parser em `steam-rss.js`

---

## 🔔 Discord

Cada jogo pode notificar um canal diferente no Discord.

### Configuração:

1. Crie um webhook no seu servidor Discord (Configurações → Integrações → Webhooks)
2. Adicione a URL como secret no GitHub (Settings → Secrets → Actions):
   - `DISCORD_WEBHOOK_INZOI`
   - `DISCORD_WEBHOOK_SIMS4`
   - `DISCORD_WEBHOOK_PARALIVES`
3. O campo `discord.webhookSecretName` no config JSON aponta para o nome do secret

**Features:**
- Embeds ricos com thumbnail, link e categoria
- Máximo 5 notificações por execução (evita spam)
- Falha no Discord **nunca** interrompe a geração dos RSS

---

## 🛠️ Desenvolvimento

### Requisitos
- **Node.js >= 22** (usa `fetch` nativo e ESM)
- **Zero dependências npm**

### Executar localmente

```bash
# Gerar todos os RSS
node lib/orchestrator.js

# Ou via npm
npm run generate
```

### Estrutura de diretórios

```
game-rss/
├── .github/workflows/
│   ├── update-rss.yml        # CI: gera RSS, commita, notifica
│   └── deploy-pages.yml       # CD: deploy public/ → GitHub Pages
├── config/sources/            # Config JSON por jogo
├── lib/
│   ├── orchestrator.js        # Entry point
│   ├── rss-generator.js       # Gerador RSS 2.0
│   ├── history.js             # Histórico JSON
│   ├── discord.js             # Notificador Discord
│   ├── fetch-utils.js         # Fetch resiliente
│   ├── xml-utils.js           # Utilitários XML
│   └── source-adapters/       # Adaptadores por jogo
├── data/                      # Histórico por jogo (git-versionado)
├── public/                    # RSS gerados (servido via Pages)
│   ├── index.html
│   ├── inzoi.xml
│   ├── thesims4.xml
│   └── paralives.xml
└── PLAN.md                    # Planejamento detalhado
```

---

## 📋 Variáveis de Ambiente e Secrets

| Secret | Descrição |
|--------|-----------|
| `KRAFTON_NAMESPACE` | Namespace da API KRAFTON (ex: `inZOI_Official-xxxx`) |
| `KRAFTON_GAME` | Game ID da API KRAFTON (ex: `inzoi`) |
| `DISCORD_WEBHOOK_INZOI` | Webhook URL do canal inZOI no Discord |
| `DISCORD_WEBHOOK_SIMS4` | Webhook URL do canal The Sims 4 no Discord |
| `DISCORD_WEBHOOK_PARALIVES` | Webhook URL do canal Paralives no Discord |

---

## 📄 Licença

MIT — veja o código e adapte como quiser.

---

**Mantenedor:** [@carolslima](https://github.com/carolslima)  
**Repositório:** [github.com/carolslima/game-rss](https://github.com/carolslima/game-rss)
