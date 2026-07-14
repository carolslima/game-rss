// =============================================================================
// Patreon Carol Gamer — API Adapter (público + autenticado com refresh)
// =============================================================================
// Modo público (sem token):     API v1 — apenas posts públicos
// Modo autenticado (com token): API v2 — posts públicos + privados
//
// Secrets necessárias (GitHub Actions):
//   PATREON_ACCESS_TOKEN  — Creator's Access Token (obrigatório p/ privados)
//   PATREON_REFRESH_TOKEN — Creator's Refresh Token (opcional, p/ renovação automática)
//   PATREON_CLIENT_ID     — Client ID (opcional, p/ renovação automática)
//   PATREON_CLIENT_SECRET — Client Secret (opcional, p/ renovação automática)
//
// Obter tokens em: https://www.patreon.com/portal/registration/register-clients

const PATREON_URL = "https://www.patreon.com";

// ---------------------------------------------------------------------------
// Parse de conteúdo
// ---------------------------------------------------------------------------

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<\/li>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextFromNode(node) {
  if (!node) return "";
  const parts = [];
  if (node.type === "text" && node.text) {
    parts.push(node.text);
  }
  if (node.content && Array.isArray(node.content)) {
    for (const child of node.content) {
      parts.push(extractTextFromNode(child));
    }
  }
  return parts.join("");
}

function parseContentJson(contentJsonString) {
  if (!contentJsonString) return "";
  try {
    const doc = JSON.parse(contentJsonString);
    return extractTextFromNode(doc).trim();
  } catch {
    return "";
  }
}

function extractImageFromNode(node) {
  if (!node) return null;
  if (node.type === "image" && node.attrs?.src) {
    return node.attrs.src;
  }
  if (node.content && Array.isArray(node.content)) {
    for (const child of node.content) {
      const img = extractImageFromNode(child);
      if (img) return img;
    }
  }
  return null;
}

function extractImageFromContentJson(contentJsonString) {
  if (!contentJsonString) return null;
  try {
    const doc = JSON.parse(contentJsonString);
    return extractImageFromNode(doc);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Autenticação e refresh de token
// ---------------------------------------------------------------------------

/**
 * Tenta renovar o access token usando o refresh token.
 * Retorna o novo access token ou null se falhar.
 */
async function refreshAccessToken(clientId, clientSecret, refreshToken, log) {
  if (!clientId || !clientSecret || !refreshToken) {
    log("[WARN]", "Refresh indisponível — faltam PATREON_CLIENT_ID, PATREON_CLIENT_SECRET ou PATREON_REFRESH_TOKEN");
    return null;
  }

  log("[INFO]", "Tentando renovar access token...");

  try {
    const resp = await fetch(`${PATREON_URL}/api/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "GameRSS-Agent/1.0",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!resp.ok) {
      log("[ERROR]", `Refresh falhou: HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    if (data.access_token) {
      log("[OK]", "Token renovado com sucesso");
      return data.access_token;
    }

    log("[ERROR]", "Resposta de refresh sem access_token");
    return null;
  } catch (err) {
    log("[ERROR]", `Erro ao renovar token: ${err.message}`);
    return null;
  }
}

/**
 * Fetch autenticado com retry + refresh de token.
 * Usa fetch bruto (sem fetchWithRetry) para conseguir capturar HTTP 401
 * e renovar o token antes de retentar.
 */
async function authenticatedFetch(url, currentToken, clientId, clientSecret, refreshToken, log, fetchConfig) {
  const { timeoutMs = 30000, maxRetries = 3, retryBaseDelayMs = 1000 } = fetchConfig;

  let token = currentToken;
  let lastError = null;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        headers: {
          "User-Agent": "GameRSS-Agent/1.0",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (resp.ok) {
        return resp;
      }

      // Token expirado? Tenta renovar uma vez e retenta sem consumir tentativa
      if (resp.status === 401 && refreshToken && clientId && clientSecret) {
        const body = await resp.text().catch(() => "");
        // Se já tentamos refresh e ainda deu 401, é falha real
        if (body.includes("invalid_grant") || body.includes("expired")) {
          log("[WARN]", "Token expirado — renovando...");
          const newToken = await refreshAccessToken(clientId, clientSecret, refreshToken, log);
          if (newToken) {
            token = newToken;
            continue;
          }
        }
      }

      // Erro HTTP sem refresh
      const body = await resp.text().catch(() => "(sem corpo)");
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);

    } catch (err) {
      lastError = err;
      if (err.name === "AbortError") {
        log("[WARN]", `Timeout na tentativa ${attempts + 1}/${maxRetries}`);
      } else {
        log("[WARN]", `Falha na tentativa ${attempts + 1}/${maxRetries}: ${err.message}`);
      }
      attempts++;
      if (attempts < maxRetries) {
        const delay = retryBaseDelayMs * Math.pow(2, attempts - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`Requisição autenticada falhou após ${maxRetries} tentativas: ${lastError?.message}`);
}

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

const postTypeLabels = {
  text_only: "Texto",
  image: "Imagem",
  image_file: "Imagem",
  video_embed: "Vídeo",
  audio_embed: "Áudio",
  link: "Link",
  poll: "Enquete",
  video: "Vídeo",
  audio: "Áudio",
  attachment: "Arquivo",
};

function normalizePost(raw, campaignWebUrl, mediaMap) {
  const attrs = raw.attributes || {};
  const id = raw.id || "";
  const title = attrs.title || "Sem título";

  // v2 retorna URLs relativas (/carolslimagamer/posts/...), v1 retorna absolutas
  let url = attrs.url || "";
  if (url && !url.startsWith("http")) {
    url = `${PATREON_URL}${url}`;
  }
  if (!url) {
    url = `${campaignWebUrl}/posts/${id}`;
  }
  const pubDate = attrs.published_at || attrs.created_at || new Date().toISOString();

  let description = "";
  if (attrs.content) {
    description = stripHtml(attrs.content);
  } else if (attrs.content_json_string) {
    description = parseContentJson(attrs.content_json_string);
  }
  if (!description && attrs.teaser_text) {
    description = stripHtml(attrs.teaser_text);
  }

  const truncatedDesc =
    description.length > 200 ? description.slice(0, 197) + "..." : description;

  // Thumbnail: v2 usa relationships.media, v1 usa content_json_string ou attrs.image
  let thumbnail = null;
  if (attrs.content_json_string) {
    thumbnail = extractImageFromContentJson(attrs.content_json_string);
  }
  if (!thumbnail && raw.relationships?.media?.data?.id && mediaMap) {
    const mediaId = raw.relationships.media.data.id;
    const media = mediaMap[mediaId];
    if (media?.image_urls?.default_small || media?.image_urls?.original) {
      thumbnail = media.image_urls.default_small || media.image_urls.original;
    }
  }
  if (!thumbnail && attrs.image) {
    thumbnail =
      typeof attrs.image === "string"
        ? attrs.image
        : attrs.image?.large_url || attrs.image?.url || null;
  }

  // Categoria: v2 pode não ter post_type
  const postType = attrs.post_type || "text_only";
  const categoryLabel = postTypeLabels[postType] || "Publicação";

  return {
    id: String(id),
    title: String(title),
    description: truncatedDesc,
    category: String(postType),
    categoryLabel: String(categoryLabel),
    pubDate: String(pubDate),
    thumbnail: thumbnail ? String(thumbnail) : null,
    link: String(url),
    guid: String(id),
    addedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Adapter principal
// ---------------------------------------------------------------------------

export default async function fetchPosts(config, context) {
  const { fetchWithRetry, log, sleep, env } = context;
  const opts = config.options || {};
  const campaignId = opts.campaignId || "8543779";
  const maxPages = opts.maxPages || 10;

  const accessToken = env?.PATREON_ACCESS_TOKEN || null;
  const refreshToken = env?.PATREON_REFRESH_TOKEN || null;
  const clientId = env?.PATREON_CLIENT_ID || null;
  const clientSecret = env?.PATREON_CLIENT_SECRET || null;
  const isAuthenticated = !!accessToken;

  log("[INFO]",
    `Modo: ${isAuthenticated
      ? `autenticado (API v2 — posts públicos + privados${refreshToken ? ", com refresh automático" : ""})`
      : "público (API v1 — somente posts públicos)"}`
  );

  let patreonGet;
  if (isAuthenticated) {
    const fetchConfig = config.fetch || {};
    // Usa função própria pois fetchWithRetry lança erro no 401 antes do refresh
    patreonGet = (url) => authenticatedFetch(
      url, accessToken, clientId, clientSecret, refreshToken, log, fetchConfig
    );
  } else {
    patreonGet = (url) => fetchWithRetry(url, {
      "User-Agent": "GameRSS-Agent/1.0",
      Accept: "application/json",
    });
  }

  // --- 1. Buscar informações da campanha ---
  const campaignApiUrl = isAuthenticated
    ? `${PATREON_URL}/api/oauth2/v2/campaigns/${campaignId}?fields%5Bcampaign%5D=name,summary,url,creation_name`
    : `${PATREON_URL}/api/campaigns/${campaignId}`;

  log("[INFO]", `Buscando campanha: ${campaignApiUrl}`);

  let campaignWebUrl = config.feedMeta?.link || "https://www.patreon.com/carolslimagamer";

  try {
    const resp = await patreonGet(campaignApiUrl);
    const campaign = await resp.json();
    if (campaign?.data?.attributes) {
      const attr = campaign.data.attributes;
      campaignWebUrl = attr.url || campaignWebUrl;
    }
  } catch (err) {
    log("[WARN]", `Campanha indisponível, usando fallback: ${err.message}`);
  }

  // --- 2. Buscar posts com paginação via cursor ---
  // API v2 exige fields explícitos com nomes de campo válidos para v2.
  // content_json_string, post_type, image, teaser_text NÃO existem na v2.
  const postsBasePath = isAuthenticated
    ? `${PATREON_URL}/api/oauth2/v2/campaigns/${campaignId}/posts?fields%5Bpost%5D=title,content,url,published_at,is_paid`
    : `${PATREON_URL}/api/campaigns/${campaignId}/posts`;

  let postsUrl = postsBasePath;
  const allPosts = [];
  let pageCount = 0;

  while (postsUrl && pageCount < maxPages) {
    pageCount++;
    log("[INFO]", `Página ${pageCount}: ${postsUrl}`);

    let resp, body;
    try {
      resp = await patreonGet(postsUrl);
      body = await resp.json();
    } catch (err) {
      log("[ERROR]", `Falha na página ${pageCount}: ${err.message}`);
      break;
    }

    const data = body?.data;
    if (Array.isArray(data) && data.length > 0) {
      const normalized = data.map((post) =>
        normalizePost(post, campaignWebUrl, {})
      );
      allPosts.push(...normalized);
      log("[INFO]", `  ${data.length} posts extraídos`);
    }

    if (body?.links?.next) {
      postsUrl = body.links.next;
      // Garante que links de paginação mantenham o parâmetro fields (API v2)
      if (isAuthenticated && !postsUrl.includes("fields%5Bpost%5D")) {
        postsUrl += "&fields%5Bpost%5D=title,content,url,published_at,is_paid";
      }
    } else {
      postsUrl = null;
    }

    if (postsUrl) {
      await sleep(200);
    }
  }

  log("[OK]", `${allPosts.length} posts extraídos (${pageCount} página(s))${isAuthenticated ? " — incluindo privados" : " — apenas públicos"}`);
  return allPosts;
}
