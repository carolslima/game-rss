// =============================================================================
// History Manager — leitura, escrita e merge de histórico por source
// =============================================================================
// Cada source tem seu próprio arquivo JSON em data/{sourceId}.json.
// O histórico mantém até `maxPosts` posts, ordenados por data decrescente.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

/**
 * Gera uma chave única para deduplicação de posts.
 * Prioridade: id > link > title+pubDate
 *
 * @param {object} post
 * @returns {string}
 */
function dedupeKey(post) {
  if (post.id) return `id:${post.id}`;
  if (post.link) return `url:${post.link}`;
  return `hash:${post.title}|${post.pubDate}`;
}

/**
 * Lê o arquivo de histórico de uma source.
 *
 * @param {string} sourceId — identificador da source (ex: "krafton-inzoi")
 * @param {Function} log — função de log com prefixo
 * @returns {Promise<Array<object>>}
 */
export async function readHistory(sourceId, log) {
  const filePath = join(ROOT, "data", `${sourceId}.json`);

  try {
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) {
      log("[WARN]", "Histórico corrompido (não é array) — resetando");
      return [];
    }
    log("[INFO]", `Histórico lido: ${data.length} posts conhecidos`);
    return data;
  } catch (err) {
    if (err.code === "ENOENT") {
      log("[INFO]", "Histórico não encontrado — iniciando vazio");
      return [];
    }
    log("[ERROR]", `Erro ao ler histórico: ${err.message}`);
    return [];
  }
}

/**
 * Salva o histórico em disco.
 *
 * @param {string} sourceId — identificador da source
 * @param {Array<object>} posts — array de posts
 * @returns {Promise<void>}
 */
export async function writeHistory(sourceId, posts) {
  const filePath = join(ROOT, "data", `${sourceId}.json`);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(posts, null, 2), "utf-8");
}

/**
 * Mescla novos posts ao histórico:
 * 1. Lê o histórico existente
 * 2. Detecta posts inéditos via dedupeKey()
 * 3. Adiciona os novos no topo
 * 4. Ordena por data decrescente
 * 5. Limita ao máximo configurado (historyConfig.maxPosts)
 *
 * @param {string} sourceId — identificador da source
 * @param {object} historyConfig — `{ maxPosts: number }` do source config
 * @param {Array<object>} incoming — posts normalizados (NormalizedPost[])
 * @param {Function} log — função de log com prefixo
 * @returns {Promise<{history: Array<object>, newPosts: Array<object>}>}
 */
export async function mergeHistory(sourceId, historyConfig, incoming, log) {
  const maxPosts = historyConfig?.maxPosts ?? 300;
  const history = await readHistory(sourceId, log);
  const seen = new Set(history.map((p) => dedupeKey(p)));

  const newPosts = [];
  for (const post of incoming) {
    const key = dedupeKey(post);
    if (!seen.has(key)) {
      seen.add(key);
      newPosts.push(post);
    }
  }

  if (newPosts.length > 0) {
    log("[INFO]", `${newPosts.length} nova(s) notícia(s) detectada(s)`);
    const merged = [...newPosts, ...history];
    // Ordena por data decrescente
    merged.sort((a, b) => {
      const da = new Date(a.pubDate || a.addedAt || 0);
      const db = new Date(b.pubDate || b.addedAt || 0);
      return db - da;
    });
    const trimmed = merged.slice(0, maxPosts);
    await writeHistory(sourceId, trimmed);
    return { history: trimmed, newPosts };
  }

  log("[INFO]", "Nenhuma notícia nova detectada");
  return { history, newPosts: [] };
}
