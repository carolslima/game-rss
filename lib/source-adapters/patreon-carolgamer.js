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
 * Cria uma função fetch autenticada que renova o token automaticamente
 * em caso de 401 e retenta a requisição.
 */
function createAuthenticatedFetch(accessToken, clientId, clientSecret, refreshToken, log, fetchWithRetry) {
  let currentToken = accessToken;

  return async function patreonFetch(url) {
    let resp = await fetchWithRetry(url, {
      "User-Agent": "GameRSS-Agent/1.0",
      Accept: "application/json",
      Authorization: `Bearer ${currentToken}`,
    });

    if (resp.status === 401 && refreshToken && clientId && clientSecret) {
      log("[WARN]", "Token expirado (401) — tentando renovar...");
      const newToken = await refreshAccessToken(clientId, clientSecret, refreshToken, log);

      if (newToken) {
        currentToken = newToken;
        log("[INFO]", "Re-tentando requisição com novo token...");
        resp = await fetchWithRetry(url, {
          "User-Agent": "GameRSS-Agent/1.0",
          Accept: "application/json",
          Authorization: `Bearer ${currentToken}`,
        });
      }
    }

    return resp;
  };
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

function normalizePost(raw, campaignWebUrl) {
  const attrs = raw.attributes || {};
  const id = raw.id || "";
  const title = attrs.title || "Sem título";
  const url = attrs.url || `${campaignWebUrl}/posts/${id}`;
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
    description.length > 100 ? description.slice(0, 97) + "..." : description;

  let thumbnail = null;
  if (attrs.content_json_string) {
    thumbnail = extractImageFromContentJson(attrs.content_json_string);
  }
  if (!thumbnail && attrs.image) {
    thumbnail =
      typeof attrs.image === "string"
        ? attrs.image
        : attrs.image?.large_url || attrs.image?.url || null;
  }

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
    patreonGet = createAuthenticatedFetch(
      accessToken, clientId, clientSecret, refreshToken, log, fetchWithRetry
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
  const postsBasePath = isAuthenticated
    ? `${PATREON_URL}/api/oauth2/v2/campaigns/${campaignId}/posts`
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
        normalizePost(post, campaignWebUrl)
      );
      allPosts.push(...normalized);
      log("[INFO]", `  ${data.length} posts extraídos`);
    }

    if (body?.links?.next) {
      postsUrl = body.links.next;
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
