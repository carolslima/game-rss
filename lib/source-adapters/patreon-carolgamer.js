// =============================================================================
// Patreon Carol Gamer — Public API Adapter
// =============================================================================
// Consome a API pública do Patreon (sem autenticação) para extrair posts
// públicos de um criador e converter para o formato NormalizedPost.
// API endpoints: www.patreon.com/api/campaigns/{id} e /posts

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
 * Extrai texto puro de um nó ProseMirror/TipTap (formato JSON de conteúdo do Patreon).
 * Percorre recursivamente a árvore de nós extraindo o texto.
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

/**
 * Converte um post da API do Patreon para NormalizedPost.
 */
function normalizePost(raw, campaignUrl) {
  const attrs = raw.attributes || {};
  const id = raw.id || "";
  const title = attrs.title || "Sem título";
  const url = attrs.url || `${campaignUrl}/posts/${id}`;

  const pubDate = attrs.published_at || attrs.created_at || new Date().toISOString();

  let description = "";

  // Prefere content (HTML) se disponível, senão usa content_json_string
  if (attrs.content) {
    description = stripHtml(attrs.content);
  } else if (attrs.content_json_string) {
    description = parseContentJson(attrs.content_json_string);
  }

  // Fallback: usa teaser_text
  if (!description && attrs.teaser_text) {
    description = stripHtml(attrs.teaser_text);
  }

  // Trunca descrição
  const truncatedDesc =
    description.length > 400 ? description.slice(0, 397) + "..." : description;

  // Thumbnail — tenta extrair do content_json, depois do campo image
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

  // Categoria baseada no post_type
  const postType = attrs.post_type || "text_only";
  const categoryLabel = postTypeLabels[postType] || "Publicação";
  const category = postType;

  return {
    id: String(id),
    title: String(title),
    description: truncatedDesc,
    category: String(category),
    categoryLabel: String(categoryLabel),
    pubDate: String(pubDate),
    thumbnail: thumbnail ? String(thumbnail) : null,
    link: String(url),
    guid: String(id),
    addedAt: new Date().toISOString(),
  };
}

const postTypeLabels = {
  text_only: "Texto",
  image: "Imagem",
  video_embed: "Vídeo",
  audio_embed: "Áudio",
  link: "Link",
  poll: "Enquete",
  video: "Vídeo",
  audio: "Áudio",
  attachment: "Arquivo",
};

const DEFAULT_HEADERS = {
  "User-Agent": "GameRSS-Agent/1.0",
  Accept: "application/json",
};

/**
 * Adapter principal.
 * @param {object} config — source config completo
 * @param {object} context — { fetchWithRetry, log, sleep, env }
 * @returns {Promise<Array<object>>} NormalizedPost[]
 */
export default async function fetchPosts(config, context) {
  const { fetchWithRetry, log } = context;
  const opts = config.options || {};
  const campaignId = opts.campaignId || "8543779";
  const maxPages = opts.maxPages || 10;

  // --- 1. Buscar informações da campanha ---
  const campaignUrl = `${PATREON_URL}/api/campaigns/${campaignId}`;
  log("[INFO]", `Buscando campanha: ${campaignUrl}`);

  let campaignName = config.name || "Carol Gamer";
  let campaignSummary = "";
  let campaignWebUrl = config.feedMeta?.link || "https://www.patreon.com/carolslimagamer";

  try {
    const resp = await fetchWithRetry(campaignUrl, DEFAULT_HEADERS);
    const campaign = await resp.json();
    if (campaign?.data?.attributes) {
      const attr = campaign.data.attributes;
      campaignName = attr.name || campaignName;
      campaignSummary = attr.summary || "";
      campaignWebUrl = attr.url || campaignWebUrl;
    }
  } catch (err) {
    log("[WARN]", `Campanha indisponível, usando fallback: ${err.message}`);
  }

  // --- 2. Buscar posts com paginação via cursor ---
  let postsUrl = `${PATREON_URL}/api/campaigns/${campaignId}/posts`;
  const allPosts = [];
  let pageCount = 0;

  while (postsUrl && pageCount < maxPages) {
    pageCount++;
    log("[INFO]", `Página ${pageCount}: ${postsUrl}`);

    let resp, body;
    try {
      resp = await fetchWithRetry(postsUrl, DEFAULT_HEADERS);
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

    // Próxima página via cursor
    if (body?.links?.next) {
      postsUrl = body.links.next;
    } else {
      postsUrl = null;
    }

    // Pequena pausa entre páginas para respeitar rate limits
    if (postsUrl) {
      await context.sleep(200);
    }
  }

  log("[OK]", `${allPosts.length} posts extraídos (${pageCount} página(s))`);
  return allPosts;
}
