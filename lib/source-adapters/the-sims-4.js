// =============================================================================
// The Sims 4 — EA pt-br News Scraper
// =============================================================================
// Extrai notícias do site ea.com/pt-br/games/the-sims/the-sims-4/news.
// A página é Next.js com dados JSON em __NEXT_DATA__.
// Usa paginação via _next/data para obter todos os artigos.
// Títulos e resumos estão em português brasileiro.

function parseNewsUrl(newsUrl) {
  const u = new URL(newsUrl);
  const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  return {
    origin: u.origin,
    locale: parts[0],
    franchiseSlug: parts[2],
    gameSlug: parts[3],
    base: u.origin + "/" + parts.join("/"),
    path: u.pathname.replace(/\/+$/, ""),
  };
}

function parseNextData(html) {
  const match = html.match(/"__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractArticlesFromFallback(newsData, baseUrl) {
  const articles = [];
  const seen = new Set();

  const items = newsData.items || [];
  const featured = newsData.featured;

  if (featured && featured.slug && !seen.has(featured.slug)) {
    seen.add(featured.slug);
    articles.push(normalizeArticle(featured, baseUrl));
  }

  for (const item of items) {
    if (!item.slug || seen.has(item.slug)) continue;
    seen.add(item.slug);
    articles.push(normalizeArticle(item, baseUrl));
  }

  return { articles, totalItems: newsData.totalItems || 0 };
}

function normalizeArticle(raw, baseUrl) {
  const img = raw.image || {};
  const imageUrl = img.ar16X9 || img.ar1X1 || null;
  const url = `${baseUrl}/${raw.slug}`;

  return {
    title: raw.title || "",
    summary: raw.summary || "",
    slug: raw.slug,
    date: raw.publishingDate || "",
    image: imageUrl,
    url,
    type: raw.type || "Notícia",
  };
}

export default async function fetchPosts(config, context) {
  const { fetchWithRetry, log, sleep } = context;

  const newsUrl = config.options?.newsUrl;
  const newsMeta = parseNewsUrl(newsUrl);

  const htmlHeaders = {
    "User-Agent": "GameRSS-Agent/1.0",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
    Accept: "text/html,application/xhtml+xml",
    ...(config.options?.fetchHeaders || {}),
  };

  const jsonHeaders = {
    "User-Agent": "GameRSS-Agent/1.0",
    "Accept-Language": "pt-BR,pt;q=0.9",
    Accept: "application/json",
  };

  log("[INFO]", `Fetching EA pt-br news: ${newsUrl}`);

  const resp = await fetchWithRetry(newsUrl, htmlHeaders);
  const html = await resp.text();

  log("[INFO]", `HTML recebido: ${html.length} bytes`);

  const nextData = parseNextData(html);
  if (!nextData) {
    log("[WARN]", "Não foi possível parsear __NEXT_DATA__ — tentando fallback Steam RSS...");
    return steamFallback(config, context);
  }

  const buildId = nextData.buildId;
  const newsData = nextData?.props?.pageProps?.newsDataFallback;

  if (!newsData || !buildId) {
    log("[WARN]", "Dados de notícias ou buildId não encontrados — tentando fallback Steam RSS...");
    return steamFallback(config, context);
  }

  let { articles, totalItems } = extractArticlesFromFallback(newsData, newsMeta.base);
  const allSlugs = new Set(articles.map((a) => a.slug));
  log("[INFO]", `Página 1: ${articles.length} artigos (total disponível: ${totalItems})`);

  const maxPages = Math.ceil(totalItems / 13) + 5;
  let page = 2;

  while (page <= maxPages) {
    const dataUrl = `${newsMeta.origin}/_next/data/${buildId}${newsMeta.path}.json?franchiseSlug=${newsMeta.franchiseSlug}&gameSlug=${newsMeta.gameSlug}&page=${page}`;
    try {
      await sleep(300);

      const dataResp = await fetchWithRetry(dataUrl, jsonHeaders);
      const text = await dataResp.text();
      const data = JSON.parse(text);
      const pageFallback = data?.pageProps?.newsDataFallback;

      if (!pageFallback) {
        log("[INFO]", `Página ${page}: sem dados — parando paginação`);
        break;
      }

      const { articles: pageArticles } = extractArticlesFromFallback(pageFallback, newsMeta.base);
      const newArticles = pageArticles.filter((a) => !allSlugs.has(a.slug));

      if (newArticles.length === 0) {
        log("[INFO]", `Página ${page}: sem artigos novos — parando paginação`);
        break;
      }

      for (const a of newArticles) {
        allSlugs.add(a.slug);
        articles.push(a);
      }

      log("[INFO]", `Página ${page}: +${newArticles.length} artigos (total acumulado: ${articles.length})`);
      page++;
    } catch (err) {
      log("[WARN]", `Erro na página ${page}: ${err.message} — parando paginação`);
      break;
    }
  }

  if (articles.length === 0) {
    log("[WARN]", "Nenhum artigo encontrado — tentando fallback Steam RSS...");
    return steamFallback(config, context);
  }

  log("[OK]", `${articles.length} artigos extraídos de ${totalItems} disponíveis`);

  const catLabels = config.options?.categoryLabels || {
    news: "Notícia",
    update: "Atualização",
    announcement: "Anúncio",
    event: "Evento",
  };

  const posts = articles.map((a) => {
    const category = guessCategory(a.title, a.summary, a.type);
    return {
      id: a.slug,
      title: a.title,
      description: a.summary || a.title,
      category,
      categoryLabel: catLabels[category] || a.type || "Notícia",
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

function guessCategory(title, summary, type) {
  if (type) {
    if (type === "Notas do patch" || type === "Atualizações do jogo") return "update";
    if (type === "Lista de Tarefas") return "update";
  }

  const text = `${title} ${summary}`.toLowerCase();

  if (/atualização|patch|hotfix|correção|bug|laundry\s*list/.test(text)) return "update";
  if (/anúncio|lançamento|chegou|disponível/.test(text)) return "announcement";
  if (/evento|festival|desafio/.test(text)) return "event";
  if (/mercado|marketplace|maker|programa|creator/.test(text)) return "announcement";
  if (/perguntas|faq|guia/.test(text)) return "news";

  return "news";
}

async function steamFallback(config, context) {
  const { fetchWithRetry, log } = context;
  const steamUrl = config.options?.steamFallbackUrl;

  log("[INFO]", `Fallback Steam RSS: ${steamUrl}`);

  const steamResp = await fetchWithRetry(steamUrl, {
    "User-Agent": "GameRSS-Agent/1.0",
    Accept: "application/rss+xml, application/xml, text/xml",
  });
  const steamXml = await steamResp.text();

  const { parseSteamRss } = await import("./steam-rss.js");
  const steamPosts = parseSteamRss(steamXml, config);
  log("[OK]", `${steamPosts.length} posts do fallback Steam`);
  return steamPosts;
}
