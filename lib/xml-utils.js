// =============================================================================
// XML Utilities — escape, CDATA, enclosure
// =============================================================================
// Funções compartilhadas para geração de XML seguro e compatível com RSS 2.0.

/**
 * Escapa caracteres especiais para conteúdo XML.
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeXml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Envolve texto em CDATA quando necessário (contém <, > ou &).
 * Trata corretamente sequências "]]>" dentro do texto.
 *
 * @param {string} str
 * @returns {string}
 */
export function cdata(str) {
  if (typeof str !== "string") return "";
  const needsCdata = /[<>&]/.test(str);
  if (needsCdata) {
    const safe = str.replace(/]]>/g, "]]]]><![CDATA[>");
    return `<![CDATA[${safe}]]>`;
  }
  return escapeXml(str);
}

/**
 * Gera tag <enclosure> para imagens (compatível com Feedly, Thunderbird, etc.).
 *
 * @param {string|null} url — URL da imagem
 * @param {string} [type="image/jpeg"] — MIME type
 * @returns {string} tag <enclosure> ou string vazia se url for nula
 */
export function enclosureTag(url, type = "image/jpeg") {
  if (!url || typeof url !== "string") return "";
  // Determina o MIME type pela extensão
  let mime = type;
  if (/\.png($|\?)/i.test(url)) mime = "image/png";
  else if (/\.webp($|\?)/i.test(url)) mime = "image/webp";
  else if (/\.gif($|\?)/i.test(url)) mime = "image/gif";
  return `<enclosure url="${escapeXml(url)}" type="${mime}"/>`;
}
