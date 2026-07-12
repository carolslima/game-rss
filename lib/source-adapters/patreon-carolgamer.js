// =============================================================================
// Patreon Carol Gamer — API Adapter (público + autenticado)
// =============================================================================
// Modo público (sem token):     API v1 — apenas posts públicos
// Modo autenticado (com token): API v2 — posts públicos + privados
//
// Para ativar o modo autenticado, defina a env var PATREON_ACCESS_TOKEN.
// O token é obtido em: https://www.patreon.com/portal/registration/register-clients
// (Creator's Access Token — sem necessidade de fluxo OAuth completo)

const PATREON_URL = "https://www.patreon.com";

/**
 * Remove tags HTML preservando espaços.
 */
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

/**
 * Extrai texto puro de um nó ProseMirror/TipTap.
 */
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

/**
 * Converte content_json_string para texto plano.
 */
function parseContentJson(contentJsonString) {
  if (!contentJsonString) return "";
  try {
    const doc = JSON.parse(contentJsonString);
    return extractTextFromNode(doc).trim();
  } catch {
    return "";
  }
}

/**
 * Extrai a primeira imagem de um nó ProseMirror/TipTap.
 */
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

/**
 * Extrai a primeira imagem do content_json_string.
 */
function extractImageFromContentJson(contentJsonString) {
  if (!contentJsonString) return null;
  try {
    const doc = JSON.parse(contentJsonString);
    return extractImageFromNode(doc);
  } catch {
    return null;
  }
}

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

/**
 * Converte um post da API do Patreon para NormalizedPost.
 */
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
    description.length > 400 ? description.slice(0, 397) + "..." : description;

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

/**
 * Adapter principal.
 */
export default async function fetchPosts(config, context) {
  const { fetchWithRetry, log, sleep, env } = context;
  const opts = config.options || {};
  const campaignId = opts.campaignId || "8543779";
  const maxPages = opts.maxPages || 10;

  const accessToken = env?.PATREON_ACCESS_TOKEN || null;
  const isAuthenticated = !!accessToken;

  log("[INFO]", `Modo: ${isAuthenticated ? "autenticado (API v2 — posts públicos + privados)" : "público (API v1 — somente posts públicos)"}`);

  // --- 1. Buscar informações da campanha ---
  const campaignApiUrl = isAuthenticated
    ? `${PATREON_URL}/api/oauth2/v2/campaigns/${campaignId}?fields%5Bcampaign%5D=name,summary,url,creation_name`
    : `${PATREON_URL}/api/campaigns/${campaignId}`;

  log("[INFO]", `Buscando campanha: ${campaignApiUrl}`);

  const authHeaders = isAuthenticated
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  let campaignWebUrl = config.feedMeta?.link || "https://www.patreon.com/carolslimagamer";

  try {
    const resp = await fetchWithRetry(campaignApiUrl, {
      "User-Agent": "GameRSS-Agent/1.0",
      Accept: "application/json",
      ...authHeaders,
    });
    const campaign = await resp.json();
    if (campaign?.data?.attributes) {
      const attr = campaign.data.attributes;
      campaignWebUrl = attr.url || campaignWebUrl;
    }
  } catch (err) {
    log("[WARN]", `Campanha indisponível, usando fallback: ${err.message}`);
  }

  // --- 2. Buscar posts com paginação via cursor ---
  // API v2 usa /api/oauth2/v2/, API v1 pública usa /api/
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
      resp = await fetchWithRetry(postsUrl, {
        "User-Agent": "GameRSS-Agent/1.0",
        Accept: "application/json",
        ...authHeaders,
      });
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
