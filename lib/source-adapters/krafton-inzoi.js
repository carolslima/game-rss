// =============================================================================
// inZOI — KRAFTON API Adapter
// =============================================================================
// Consome a API HAL+JSON da KRAFTON (api-foc.krafton.com) e converte para
// o formato NormalizedPost.

/**
 * @param {object} config — source config completo (krafton-inzoi.json)
 * @param {object} context — { fetchWithRetry, log, sleep, env }
 * @returns {Promise<Array<object>>} NormalizedPost[]
 */
export default async function fetchPosts(config, context) {
  const { fetchWithRetry, log, sleep } = context;
  const opts = config.options || {};

  const API_BASE = opts.apiBase;
  const API_PARAMS = opts.apiParams || "lang=pt-br&searchType=TITLE_AND_CONTENT";
  const API_PAGE_SIZE = opts.apiPageSize || 20;
  const MAX_PAGES = opts.maxPages || 50;
  const catLabels = opts.categoryLabels || {};

  // --- Auto-descoberta de namespace/game ---
  // Busca os valores no HTML do site playinzoi.com (sempre atualizados).
  // Fallback: valores definidos no config JSON.
  let namespace = opts.namespaceFallback || "";
  let game = opts.gameFallback || "";

  try {
    log("[INFO]", "Auto-descobrindo configuração da API...");
    const discoveryUrl = opts.discoveryUrl;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15_000);

    const resp = await fetch(discoveryUrl, {
      headers: {
        "User-Agent": "GameRSS-Agent/1.0",
        Accept: "text/html",
      },
      signal: controller.signal,
    });

    if (resp.ok) {
      const html = await resp.text();
      const nsMatch = html.match(/namespace\s*["':]+\s*["']?([^"',&\s]+)/i);
      const gameMatch = html.match(/game\s*["':]+\s*["']?([^"',&\s]+)/i);

      if (nsMatch) namespace = nsMatch[1];
      if (gameMatch) game = gameMatch[1];

      if (nsMatch && gameMatch) {
        log("[OK]", `Config descoberta: namespace=${namespace}, game=${game}`);
      }
    }
  } catch (err) {
    log("[WARN]", `Auto-descoberta falhou: ${err.message} — usando fallback do config`);
  }

  // --- Headers da API ---
  function getApiHeaders() {
    return {
      Accept: "application/hal+json, application/json",
      "Content-Type": "application/json",
      "User-Agent": "GameRSS-Agent/1.0",
      Origin: opts.apiHeaders?.Origin,
      Referer: opts.apiHeaders?.Referer,
      "service-lang": "pt-br",
      "service-namespace": namespace,
      "service-game": game,
    };
  }

  // --- Busca paginada ---
  const allPosts = [];

  // Pagina 1
  const firstUrl = `${API_BASE}?${API_PARAMS}&size=${API_PAGE_SIZE}&page=1`;
  log("[INFO]", `Fetching página 1: ${firstUrl}`);

  const firstResp = await fetchWithRetry(firstUrl, getApiHeaders());
  const firstBody = await firstResp.json();

  const firstBatch = extractPosts(firstBody, log);
  allPosts.push(...firstBatch);

  const totalPages = Math.min(firstBody?.page?.totalPages ?? 1, MAX_PAGES);
  const totalElements = firstBody?.page?.totalElements ?? firstBatch.length;
  log("[INFO]", `Total: ${totalElements} notícias em ${totalPages} página(s)`);

  // Páginas restantes
  for (let page = 2; page <= totalPages; page++) {
    const url = `${API_BASE}?${API_PARAMS}&size=${API_PAGE_SIZE}&page=${page}`;
    try {
      const resp = await fetchWithRetry(url, getApiHeaders());
      const body = await resp.json();
      const batch = extractPosts(body, log);
      allPosts.push(...batch);
      log("[INFO]", `Página ${page}/${totalPages}: ${batch.length} posts`);
    } catch (err) {
      log("[ERROR]", `Falha na página ${page}: ${err.message}`);
    }
  }

  // --- Normalização ---
  const urlTemplate = opts.urlTemplate;
  const normalized = allPosts
    .map((raw) => normalizePost(raw, urlTemplate, catLabels))
    .filter((p) => p.title || p.id);

  log("[OK]", `${normalized.length} posts normalizados`);
  return normalized;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractPosts(body, log) {
  if (!body || typeof body !== "object") return [];

  // HAL+JSON (Spring HATEOAS)
  if (body._embedded && Array.isArray(body._embedded.post)) {
    return body._embedded.post;
  }

  // Fallbacks
  const candidates =
    body._embedded?.content ??
    body.content ??
    body.data ??
    body.posts ??
    body.items ??
    body.results ??
    null;

  if (Array.isArray(candidates)) return candidates;
  if (Array.isArray(body)) return body;

  log("[WARN]", "Formato de resposta não reconhecido");
  return [];
}

function normalizePost(raw, urlTemplate, catLabels) {
  const id = raw.postId ?? raw.id ?? raw.postContentId ?? "";
  const title = raw.title ?? "";
  const category = raw.category ?? raw.identifier ?? "";
  const categoryLabel = catLabels[category] || category;
  const pubDate = raw.displayStartTime ?? raw.createdAt ?? raw.publishedAt ?? "";

  const images = raw.images ?? [];
  const thumbnail =
    images.find((img) => img.key === "thumbnail")?.imageUrl ??
    images[0]?.imageUrl ??
    null;

  const lang = raw.lang ?? "pt-br";
  const link = urlTemplate
    .replace("{postId}", String(id))
    .replace("{lang}", String(lang));

  const description = [
    `[${categoryLabel}] ${title}`,
    raw.totalViewCnt ? `${raw.totalViewCnt} visualizações` : "",
  ]
    .filter(Boolean)
    .join(" — ");

  return {
    id: String(id),
    title: String(title),
    description: String(description),
    category: String(category),
    categoryLabel: String(categoryLabel),
    pubDate: String(pubDate),
    thumbnail: thumbnail ? String(thumbnail) : null,
    link: String(link),
    guid: null,
    addedAt: new Date().toISOString(),
  };
}
