// =============================================================================
// Steam RSS Adapter (compartilhado)
// =============================================================================
// Faz parse de feeds RSS do Steam (store.steampowered.com/feeds/news/app/{appid}/)
// e converte para o formato NormalizedPost.

/**
 * Remove tags HTML de uma string, preservando espaços entre elementos.
 * Não é um parser perfeito — serve para gerar uma descrição limpa para o feed.
 *
 * @param {string} html
 * @returns {string}
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
 * Extrai a URL da primeira imagem de uma string HTML.
 *
 * @param {string} html
 * @returns {string|null}
 */
function extractFirstImage(html) {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

/**
 * Extrai a categoria a partir do título do post.
 * Heurística: detecta padrões como "Patch", "Hotfix", "Known Issue", "Sale", etc.
 *
 * @param {string} title
 * @returns {{ category: string, categoryLabel: string }}
 */
function guessCategory(title) {
  const lower = (title || "").toLowerCase();

  if (/patch\s*(notes?)?\s*\d/i.test(lower) || /\d+\.\d+\.\d+/.test(lower)) {
    return { category: "patch_note", categoryLabel: "Patch Note" };
  }
  if (/hotfix/i.test(lower)) {
    return { category: "hotfix", categoryLabel: "Hotfix" };
  }
  if (/known\s*issue/i.test(lower)) {
    return { category: "known_issue", categoryLabel: "Known Issue" };
  }
  if (/sale|discount|off/i.test(lower)) {
    return { category: "sale", categoryLabel: "Sale" };
  }
  if (/update|upcoming|coming/i.test(lower)) {
    return { category: "update", categoryLabel: "Update" };
  }
  if (/million|copies|milestone/i.test(lower)) {
    return { category: "milestone", categoryLabel: "Milestone" };
  }
  if (/event|challenge|competition/i.test(lower)) {
    return { category: "event", categoryLabel: "Event" };
  }
  if (/feedback|survey|input/i.test(lower)) {
    return { category: "feedback", categoryLabel: "Feedback" };
  }
  if (/laundry list/i.test(lower)) {
    return { category: "laundry_list", categoryLabel: "Laundry List" };
  }

  return { category: "news", categoryLabel: "News" };
}

/**
 * Faz parse de um feed RSS do Steam e retorna NormalizedPost[].
 *
 * @param {string} xml — string XML do feed RSS
 * @param {object} config — source config
 * @returns {Array<object>} NormalizedPost[]
 */
export function parseSteamRss(xml, config) {
  const posts = [];

  // Regex simples para extrair items (evita dependência de parser XML)
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const itemXml = itemMatch[1];

    const title = extractTag(itemXml, "title");
    const link = extractTag(itemXml, "link");
    const pubDate = extractTag(itemXml, "pubDate");
    const guid = extractTag(itemXml, "guid");
    const descriptionHtml = extractTag(itemXml, "description");
    const enclosureUrl = extractAttr(itemXml, "enclosure", "url");

    if (!title) continue;

    // ID: usa o GUID ou extrai do link Steam
    const id =
      extractSteamNewsId(link) ||
      extractSteamNewsId(guid) ||
      Buffer.from(title).toString("base64").slice(0, 32);

    // Categoria por heurística
    const { category, categoryLabel } = guessCategory(title);

    // Thumbnail: enclosure > primeira imagem no HTML > null
    const thumbnail = enclosureUrl || extractFirstImage(descriptionHtml);

    // Descrição limpa (sem HTML)
    const cleanDesc = stripHtml(descriptionHtml);
    const truncatedDesc =
      cleanDesc.length > 500 ? cleanDesc.slice(0, 497) + "..." : cleanDesc;

    posts.push({
      id: String(id),
      title: String(title),
      description: truncatedDesc,
      category,
      categoryLabel,
      pubDate: String(pubDate || new Date().toISOString()),
      thumbnail: thumbnail || null,
      link: String(link || config.feedMeta?.link || ""),
      guid: guid ? String(guid) : null,
      addedAt: new Date().toISOString(),
    });
  }

  return posts;
}

/**
 * Extrai o conteúdo de uma tag XML simples.
 * Suporta tags com CDATA.
 *
 * @param {string} xml
 * @param {string} tagName
 * @returns {string|null}
 */
function extractTag(xml, tagName) {
  // Tenta CDATA primeiro
  const cdataRegex = new RegExp(
    `<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tagName}>`,
    "i"
  );
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // Tenta sem CDATA
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = xml.match(regex);
  if (match) {
    return match[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  return null;
}

/**
 * Extrai um atributo de uma tag XML.
 *
 * @param {string} xml
 * @param {string} tagName
 * @param {string} attrName
 * @returns {string|null}
 */
function extractAttr(xml, tagName, attrName) {
  const regex = new RegExp(
    `<${tagName}[^>]*${attrName}=["']([^"']+)["'][^>]*\\/?>`,
    "i"
  );
  const match = xml.match(regex);
  return match ? match[1] : null;
}

/**
 * Extrai o ID numérico da notícia de uma URL do Steam.
 * Ex: "https://store.steampowered.com/news/app/1222670/view/667243351111633379"
 * Retorna "667243351111633379".
 *
 * @param {string} url
 * @returns {string|null}
 */
function extractSteamNewsId(url) {
  if (!url) return null;
  const match = url.match(/\/view\/(\d+)/);
  return match ? match[1] : null;
}
