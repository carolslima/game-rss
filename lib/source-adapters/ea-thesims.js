// =============================================================================
// The Sims — EA pt-br News Scraper
// =============================================================================
// Extrai notícias do site ea.com/pt-br/games/the-sims/news.
// A página é uma app Next.js com dados JSON embutidos no HTML.
// Títulos e resumos estão em português brasileiro.

/**
 * Extrai todos os artigos do HTML da página de notícias da EA.
 * Os dados estão em JSON inline (objetos com title, summary, slug, etc.).
 *
 * @param {string} html — HTML completo da página
 * @returns {Array<object>} artigos crus
 */
function extractArticles(html) {
  const articles = [];

  // Regex para extrair objetos de artigo do JSON embutido no HTML
  // Padrão: {"title":"...","summary":"...","image":{...},"publishingDate":"...","slug":"...","type":"Notícia"...}
  const articleRegex = /\{"title":"(?<title>[^"]+)","summary":"(?<summary>[^"]*)","image":\{(?<image>[^}]+)\},"publishingDate":"(?<date>[^"]+)","slug":"(?<slug>[^"]+)","type":"(?<type>[^"]+)"(?:,"featured":(?<featured>[^,]+))?(?:,"linkedTo":\[(?<linkedTo>[^\]]*)\])?/g;

  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const groups = match.groups;
    if (!groups || groups.type !== "Notícia") continue;

    // Extrai URL da imagem 16:9 (preferencial) ou 1:1
    const imgMatch = groups.image.match(/"ar16X9":"(?<url>[^"]+)"/);
    const imgFallback = groups.image.match(/"ar1X1":"(?<url>[^"]+)"/);
    const imageUrl = imgMatch?.groups?.url || imgFallback?.groups?.url || null;

    // Determina o jogo pelo linkedTo
    const linkedGame = groups.linkedTo
      ? groups.linkedTo.match(/"slug":"(the-sims|the-sims)"/)
      : null;
    const gameSlug = linkedGame ? linkedGame[1] : "the-sims";

    // Monta URL canônica do artigo
    const url = `https://www.ea.com/pt-br/games/${gameSlug}/news/${groups.slug}`;

    // Remove o "The Sims Mobile" dos artigos (foco é The Sims)
    if (groups.slug.includes("mobile") || groups.title.includes("The Sims Mobile")) {
      continue;
    }

    articles.push({
      title: groups.title,
      summary: groups.summary || "",
      slug: groups.slug,
      date: groups.date || "",
      image: imageUrl,
      url,
    });
  }

  return articles;
}

/**
 * Adapter principal — export default.
 *
 * @param {object} config — source config (ea-thesims.json)
 * @param {object} context — { fetchWithRetry, log, sleep, env }
 * @returns {Promise<Array<object>>} NormalizedPost[]
 */
export default async function fetchPosts(config, context) {
  const { fetchWithRetry, log } = context;

  const newsUrl = config.options?.newsUrl || "https://www.ea.com/pt-br/games/the-sims/news";

  const headers = {
    "User-Agent": "GameRSS-Agent/1.0",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
    Accept: "text/html,application/xhtml+xml",
    ...(config.options?.fetchHeaders || {}),
  };

  log("[INFO]", `Fetching EA pt-br news: ${newsUrl}`);

  const resp = await fetchWithRetry(newsUrl, headers);
  const html = await resp.text();

  log("[INFO]", `HTML recebido: ${html.length} bytes`);

  const articles = extractArticles(html);
  log("[INFO]", `${articles.length} artigos extraídos`);

  if (articles.length === 0) {
    log("[WARN]", "Nenhum artigo encontrado — tentando fallback Steam RSS...");

    // Fallback: Steam RSS
    const steamUrl = config.options?.steamFallbackUrl || "https://store.steampowered.com/feeds/news/app/1222670/?l=brazilian";
    log("[INFO]", `Fallback Steam RSS: ${steamUrl}`);

    const steamResp = await fetchWithRetry(steamUrl, {
      "User-Agent": "GameRSS-Agent/1.0",
      Accept: "application/rss+xml, application/xml, text/xml",
    });
    const steamXml = await steamResp.text();

    // Import dinâmico do parser Steam RSS
    const { parseSteamRss } = await import("./steam-rss.js");
    const steamPosts = parseSteamRss(steamXml, config);
    log("[OK]", `${steamPosts.length} posts do fallback Steam`);
    return steamPosts;
  }

  // Normalizar artigos EA → NormalizedPost
  const catLabels = config.options?.categoryLabels || {
    news: "Notícia",
    update: "Atualização",
    announcement: "Anúncio",
    event: "Evento",
  };

  const posts = articles.map((a) => {
    const category = guessCategory(a.title, a.summary);
    return {
      id: a.slug,
      title: a.title,
      description: a.summary || a.title,
      category,
      categoryLabel: catLabels[category] || "Notícia",
      pubDate: a.date || new Date().toISOString(),
      thumbnail: a.image || null,
      link: a.url,
      guid: a.url,
      addedAt: new Date().toISOString(),
    };
  });

  log("[OK]", `${posts.length} posts normalizados (pt-br)`);
  return posts;
}

/**
 * Adivinha a categoria baseado no título e resumo.
 */
function guessCategory(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();

  if (/atualização|patch|hotfix|correção|bug/.test(text)) return "update";
  if (/anúncio|lançamento|chegou|disponível/.test(text)) return "announcement";
  if (/evento|festival|desafio/.test(text)) return "event";
  if (/mercado|marketplace|maker|programa|creator/.test(text)) return "announcement";
  if (/perguntas|faq/.test(text)) return "news";

  return "news";
}
