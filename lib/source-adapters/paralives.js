// =============================================================================
// Paralives — Steam RSS Adapter
// =============================================================================
// Busca notícias do Paralives via Steam RSS feed.
// App ID: 1118520

import { parseSteamRss } from "./steam-rss.js";

/**
 * @param {object} config — source config completo (paralives.json)
 * @param {object} context — { fetchWithRetry, log, sleep, env }
 * @returns {Promise<Array<object>>} NormalizedPost[]
 */
export default async function fetchPosts(config, context) {
  const { fetchWithRetry, log } = context;

  const rssUrl =
    config.options?.rssFeedUrl ||
    "https://store.steampowered.com/feeds/news/app/1118520/";

  const headers = {
    "User-Agent": "GameRSS-Agent/1.0",
    Accept: "application/rss+xml, application/xml, text/xml",
    ...(config.options?.fetchHeaders || {}),
  };

  log("[INFO]", `Fetching Steam RSS: ${rssUrl}`);

  const resp = await fetchWithRetry(rssUrl, headers);
  const xml = await resp.text();

  const posts = parseSteamRss(xml, config);

  log("[OK]", `${posts.length} posts extraídos do feed Steam`);
  return posts;
}
