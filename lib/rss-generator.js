// =============================================================================
// RSS Generator — gerador genérico de RSS 2.0
// =============================================================================
// Gera XML RSS 2.0 a partir de feedMeta + array de NormalizedPost.
// Compatível com todos os leitores RSS do mercado.

import { escapeXml, cdata, enclosureTag } from "./xml-utils.js";

/**
 * Converte data para formato RFC 822 (padrão RSS 2.0).
 * Aceita ISO 8601 e "YYYY-MM-DD HH:mm:ss".
 *
 * @param {string} dateStr
 * @returns {string}
 */
export function toRfc822(dateStr) {
  try {
    // A API pode retornar "YYYY-MM-DD HH:mm:ss" (sem timezone)
    const normalized = dateStr.includes("T")
      ? dateStr
      : dateStr.replace(" ", "T") + "Z";
    const d = new Date(normalized);
    if (isNaN(d.getTime())) throw new Error("Data inválida");
    return d.toUTCString();
  } catch {
    return new Date().toUTCString();
  }
}

/**
 * Gera o XML completo do feed RSS 2.0.
 *
 * @param {object} feedMeta — metadados do feed (do source config)
 * @param {string} feedMeta.title — título do canal
 * @param {string} feedMeta.description — descrição
 * @param {string} feedMeta.link — URL do site
 * @param {string} feedMeta.language — código de idioma (ex: "pt-br", "en")
 * @param {string} feedMeta.feedUrl — URL pública do próprio RSS (atom:self)
 * @param {string} [feedMeta.generator] — nome do gerador
 * @param {object} [feedMeta.image] — imagem do feed { url, title, link }
 * @param {Array<object>} posts — array de NormalizedPost
 * @returns {string} XML completo
 */
export function buildRssXml(feedMeta, posts) {
  const {
    title,
    description,
    link,
    language = "en",
    feedUrl,
    generator = "Game RSS Multi-Source Generator",
    image,
  } = feedMeta;

  // Monta os itens do feed
  const items = posts
    .map((p) => {
      const guid = p.guid || p.link || `urn:game-rss:post:${p.id}`;
      const pubDate = toRfc822(p.pubDate || p.addedAt);
      const enclosure = enclosureTag(p.thumbnail);

      // Descrição enriquecida com thumbnail inline
      let descContent = cdata(p.description || p.title);
      if (p.thumbnail) {
        descContent += `<br/><img src="${escapeXml(p.thumbnail)}" alt="${escapeXml(p.title)}" style="max-width:100%;"/>`;
      }

      const lines = [
        `    <item>`,
        `      <title>${cdata(p.title)}</title>`,
        `      <description>${descContent}</description>`,
        `      <link>${escapeXml(p.link || guid)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(guid)}</guid>`,
        `      <pubDate>${pubDate}</pubDate>`,
        `      <category>${escapeXml(p.categoryLabel || p.category || "")}</category>`,
      ];

      if (enclosure) {
        lines.push(`      ${enclosure}`);
      }

      lines.push(`    </item>`);
      return lines.join("\n");
    })
    .join("\n");

  const now = toRfc822(new Date().toISOString());

  // Linhas do <channel>
  const channelLines = [
    `    <title>${escapeXml(title)}</title>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <language>${language}</language>`,
    `    <lastBuildDate>${now}</lastBuildDate>`,
    `    <generator>${escapeXml(generator)}</generator>`,
  ];

  // Imagem do feed (opcional)
  if (image?.url) {
    channelLines.push(`    <image>`);
    channelLines.push(`      <url>${escapeXml(image.url)}</url>`);
    channelLines.push(`      <title>${escapeXml(image.title || title)}</title>`);
    channelLines.push(`      <link>${escapeXml(image.link || link)}</link>`);
    channelLines.push(`    </image>`);
  }

  // atom:link self
  if (feedUrl) {
    channelLines.push(
      `    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`
    );
  }

  // Montagem final do XML
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">`,
    `  <channel>`,
    channelLines.join("\n"),
    items,
    `  </channel>`,
    `</rss>`,
  ].join("\n");
}
