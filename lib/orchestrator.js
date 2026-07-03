// =============================================================================
// Game RSS Orchestrator — entry point do motor multi-source
// =============================================================================
// 1. Lê todos os configs de config/sources/*.json
// 2. Para cada source habilitada:
//    a. Importa o adaptador
//    b. Busca posts via adapter.fetchPosts()
//    c. Mescla com histórico local
//    d. Gera RSS XML em public/
//    e. Se houver posts novos → notifica Discord
// 3. Reporta sumário
//
// Execução:
//   node lib/orchestrator.js

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildRssXml } from "./rss-generator.js";
import { mergeHistory, readHistory } from "./history.js";
import { createFetchWithRetry } from "./fetch-utils.js";
import { sendDiscordNotification } from "./discord.js";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const SOURCES_DIR = join(ROOT, "config", "sources");
const ADAPTERS_DIR = join(ROOT, "lib", "source-adapters");
const PUBLIC_DIR = join(ROOT, "public");

const LOG_LEVEL = {
  INFO: "[INFO]",
  WARN: "[WARN]",
  ERROR: "[ERROR]",
  OK: "[OK]",
};

// ---------------------------------------------------------------------------
// Utilidades de log
// ---------------------------------------------------------------------------

function ts() {
  return new Date().toISOString();
}

function log(level, ...args) {
  console.log(`${ts()} ${level}`, ...args);
}

// ---------------------------------------------------------------------------
// Carregamento de configs
// ---------------------------------------------------------------------------

async function loadSourceConfigs() {
  const files = (await readdir(SOURCES_DIR)).filter((f) => f.endsWith(".json"));
  const configs = [];
  for (const file of files.sort()) {
    try {
      const raw = await readFile(join(SOURCES_DIR, file), "utf-8");
      const cfg = JSON.parse(raw);
      if (cfg.enabled !== false) {
        configs.push(cfg);
      } else {
        log(LOG_LEVEL.INFO, `Source "${cfg.id}" desabilitada — pulando`);
      }
    } catch (err) {
      log(LOG_LEVEL.ERROR, `Erro ao carregar ${file}: ${err.message}`);
    }
  }
  return configs;
}

// ---------------------------------------------------------------------------
// Processamento de uma source
// ---------------------------------------------------------------------------

async function processSource(cfg) {
  const sourceId = cfg.id;
  const ctxLog = (level, ...args) => log(level, `[${sourceId}]`, ...args);

  ctxLog(LOG_LEVEL.INFO, `=== ${cfg.name} (${cfg.publisher}) ===`);

  // 1. Importar adaptador
  let adapter;
  try {
    const adapterPath = pathToFileURL(
      join(ADAPTERS_DIR, `${cfg.adapter}.js`)
    ).href;
    adapter = await import(adapterPath);
  } catch (err) {
    ctxLog(LOG_LEVEL.ERROR, `Adaptador "${cfg.adapter}" não encontrado: ${err.message}`);
    // Fallback: usar histórico
    const history = await readHistory(sourceId, ctxLog);
    if (history.length > 0) {
      const xml = buildRssXml(cfg.feedMeta, history);
      await writeRssFile(cfg.outputFile, xml);
    }
    return { source: sourceId, changed: false, newCount: 0, total: history.length, error: err.message };
  }

  // 2. Construir contexto
  const fetchWithRetry = createFetchWithRetry(cfg.fetch || {}, ctxLog);
  const ctx = {
    fetchWithRetry,
    log: ctxLog,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    env: process.env,
  };

  // 3. Buscar posts
  let rawPosts;
  try {
    rawPosts = await adapter.default(cfg, ctx);
  } catch (err) {
    ctxLog(LOG_LEVEL.ERROR, `Falha ao buscar posts: ${err.message}`);
    ctxLog(LOG_LEVEL.WARN, "Usando histórico existente para gerar RSS...");
    const history = await readHistory(sourceId, ctxLog);
    if (history.length > 0) {
      const xml = buildRssXml(cfg.feedMeta, history);
      await writeRssFile(cfg.outputFile, xml);
    }
    return { source: sourceId, changed: false, newCount: 0, total: history.length, error: err.message };
  }

  if (!rawPosts || rawPosts.length === 0) {
    ctxLog(LOG_LEVEL.WARN, "Zero posts recebidos — sem alterações");
    const history = await readHistory(sourceId, ctxLog);
    if (history.length > 0) {
      const xml = buildRssXml(cfg.feedMeta, history);
      await writeRssFile(cfg.outputFile, xml);
    }
    return { source: sourceId, changed: false, newCount: 0, total: history.length };
  }

  ctxLog(LOG_LEVEL.INFO, `${rawPosts.length} posts recebidos`);

  // 4. Mesclar com histórico
  const { history, newPosts } = await mergeHistory(
    sourceId,
    cfg.history || {},
    rawPosts,
    ctxLog
  );

  // 5. Gerar RSS
  const xml = buildRssXml(cfg.feedMeta, history);
  await writeRssFile(cfg.outputFile, xml);

  // 6. Discord
  if (newPosts.length > 0 && cfg.discord?.webhookSecretName) {
    const webhookUrl = process.env[cfg.discord.webhookSecretName];
    if (webhookUrl) {
      await sendDiscordNotification(webhookUrl, cfg, newPosts, ctx);
    } else {
      ctxLog(LOG_LEVEL.WARN, `Secret "${cfg.discord.webhookSecretName}" não definida — pulando Discord`);
    }
  }

  const changed = newPosts.length > 0;
  ctxLog(LOG_LEVEL.OK, `${history.length} total, ${newPosts.length} novos${changed ? " (ALTERADO)" : ""}`);

  return { source: sourceId, changed, newCount: newPosts.length, total: history.length };
}

// ---------------------------------------------------------------------------
// Escrita do RSS
// ---------------------------------------------------------------------------

async function writeRssFile(filename, xml) {
  await mkdir(PUBLIC_DIR, { recursive: true });
  await writeFile(join(PUBLIC_DIR, filename), xml, "utf-8");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function runAll() {
  log(LOG_LEVEL.INFO, "╔══════════════════════════════════════╗");
  log(LOG_LEVEL.INFO, "║   Game RSS Multi-Source Generator    ║");
  log(LOG_LEVEL.INFO, "╚══════════════════════════════════════╝");

  const sources = await loadSourceConfigs();
  log(LOG_LEVEL.INFO, `${sources.length} fonte(s) carregada(s): ${sources.map((s) => s.id).join(", ")}`);

  const results = [];
  for (const cfg of sources) {
    try {
      const result = await processSource(cfg);
      results.push(result);
    } catch (err) {
      log(LOG_LEVEL.ERROR, `[${cfg.id}] Erro fatal: ${err.message}`);
      results.push({ source: cfg.id, error: err.message });
    }
  }

  // Sumário
  log(LOG_LEVEL.INFO, "═══════════════════════════════════════");
  log(LOG_LEVEL.INFO, "SUMÁRIO:");
  for (const r of results) {
    if (r.error && !r.total) {
      log(LOG_LEVEL.ERROR, `  ${r.source}: FALHOU — ${r.error}`);
    } else if (r.error) {
      log(LOG_LEVEL.WARN, `  ${r.source}: ${r.total} posts (histórico) — API falhou: ${r.error}`);
    } else {
      log(LOG_LEVEL.OK, `  ${r.source}: ${r.total} total, ${r.newCount} novos${r.changed ? " ✨" : ""}`);
    }
  }

  const changedCount = results.filter((r) => r.changed).length;
  log(LOG_LEVEL.INFO, `${changedCount} fonte(s) com novidades`);

  return { results, anyChanged: changedCount > 0 };
}

// Execução direta
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*[\\/]/, ""))) {
  runAll()
    .then((result) => {
      if (result.anyChanged) {
        log(LOG_LEVEL.INFO, "CHANGED=true — commit necessário");
      }
      process.exit(0);
    })
    .catch((err) => {
      log(LOG_LEVEL.ERROR, `Falha crítica: ${err.message}`);
      process.exit(0); // Nunca quebra o workflow
    });
}

export { runAll };
