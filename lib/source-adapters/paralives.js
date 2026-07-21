// =============================================================================
// Paralives — Squarespace RSS Adapter
// =============================================================================
// Extrai notícias do site oficial paralives.com/news?format=rss (Squarespace).
// Conteúdo original em inglês (estúdio não publica em pt-br).

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
 * Extrai o conteúdo de uma tag XML (com ou sem CDATA, com ou sem namespace).
 */
function extractTag(xml, tagName) {
  // CDATA
  const cdataRegex = new RegExp(
    `<${tagName}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tagName}>`,
    "i"
  );
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // Sem CDATA
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
 * Adivinha categoria pelo título.
 */
function guessCategory(title) {
  const lower = (title || "").toLowerCase();
  if (/patch\s*notes?|hotfix|bug\s*fix/i.test(lower)) return "patch_note";
  if (/known\s*issue/i.test(lower)) return "known_issue";
  if (/bundle|sale|discount|now\s*available/i.test(lower)) return "announcement";
  if (/million|copies|milestone|thank\s*you/i.test(lower)) return "milestone";
  if (/update|roadmap/i.test(lower)) return "update";
  return "news";
}

const CATEGORY_LABELS = {
  patch_note: "Patch Note",
  known_issue: "Known Issue",
  announcement: "Anúncio",
  milestone: "Marco",
  update: "Atualização",
  news: "Notícia",
};

/**
 * Faz parse de um feed RSS Squarespace.
 */
function parseSquarespaceRss(xml) {
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

    // ID do guid Squarespace (formato: "hash:hash:hash")
    const id = guid || link;

    // Thumbnail da descrição HTML
    const thumbnail = extractFirstImage(descriptionHtml);

    // Descrição limpa
    const cleanDesc = stripHtml(descriptionHtml);
    const truncatedDesc =
      cleanDesc.length > 400 ? cleanDesc.slice(0, 397) + "..." : cleanDesc;

    const category = guessCategory(title);

    posts.push({
      id: String(id),
      title: String(title),
      description: truncatedDesc,
      category,
      categoryLabel: CATEGORY_LABELS[category] || "Notícia",
      pubDate: String(pubDate || new Date().toISOString()),
      thumbnail: thumbnail || null,
      link: String(link),
      guid: guid ? String(guid) : null,
      addedAt: new Date().toISOString(),
    });
  }

  return posts;
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

  log("[INFO]", `Fetching Squarespace RSS: ${rssUrl}`);

  const resp = await fetchWithRetry(rssUrl, headers);
  const xml = await resp.text();

  const posts = parseSquarespaceRss(xml);

  log("[OK]", `${posts.length} posts extraídos do site oficial`);

  // Tradução opcional (en → pt-br)
  if (config.options?.translate) {
    const { translatePosts } = await import("../translate.js");
    await translatePosts(posts, log);
  }

  return posts;
}
