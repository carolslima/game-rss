// =============================================================================
// Carol Gamer — Blogger RSS Adapter
// =============================================================================
// Extrai notícias do blog carolgamer.com via feed RSS do Blogger.
// Conteúdo 100% em português brasileiro.

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
 * Extrai a primeira imagem de HTML.
 */
function extractFirstImage(html) {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

/**
 * Extrai o conteúdo de uma tag XML (com ou sem CDATA).
 */
function extractTag(xml, tagName) {
  const cdataRegex = new RegExp(
    `<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tagName}>`,
    "i"
  );
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

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
 * Extrai todos os itens de um feed RSS Blogger.
 */
function parseBloggerRss(xml) {
  const posts = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title = extractTag(itemXml, "title");
    const link = extractTag(itemXml, "link");
    const pubDate = extractTag(itemXml, "pubDate");
    const guid = extractTag(itemXml, "guid");
    const descriptionHtml = extractTag(itemXml, "description");

    if (!title || !link) continue;

    // Extrai categorias do Blogger
    const catMatches = itemXml.matchAll(
      /<category domain="[^"]*">([^<]+)<\/category>/g
    );
    const categories = [...catMatches].map((m) => m[1]);
    const primaryCategory = categories[0] || "Geral";

    // ID do post (extrai do GUID do Blogger: tag:blogger.com,1999:blog-XXXX.post-YYYY)
    let id = link;
    if (guid) {
      const idMatch = guid.match(/\.post-(\d+)$/);
      if (idMatch) id = idMatch[1];
    }

    // Thumbnail
    const thumbnail =
      extractFirstImage(descriptionHtml) || extractFirstImage(itemXml);

    // Descrição limpa
    const cleanDesc = stripHtml(descriptionHtml);
    const truncatedDesc =
      cleanDesc.length > 400 ? cleanDesc.slice(0, 397) + "..." : cleanDesc;

    posts.push({
      id: String(id),
      title: String(title),
      description: truncatedDesc,
      category: slugify(primaryCategory),
      categoryLabel: primaryCategory,
      pubDate: String(pubDate || new Date().toISOString()),
      thumbnail: thumbnail || null,
      link: String(link),
      guid: guid ? String(guid) : null,
      addedAt: new Date().toISOString(),
    });
  }

  return posts;
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Adapter principal.
 */
export default async function fetchPosts(config, context) {
  const { fetchWithRetry, log } = context;

  const rssUrl = config.options?.rssFeedUrl;

  const headers = {
    "User-Agent": "GameRSS-Agent/1.0",
    Accept: "application/rss+xml, application/xml, text/xml",
    ...(config.options?.fetchHeaders || {}),
  };

  log("[INFO]", `Fetching Blogger RSS: ${rssUrl}`);

  const resp = await fetchWithRetry(rssUrl, headers);
  const xml = await resp.text();

  const posts = parseBloggerRss(xml);

  log("[OK]", `${posts.length} posts extraídos (pt-br)`);
  return posts;
}
