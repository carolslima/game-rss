// =============================================================================
// Translate — tradução gratuita via Google Translate (endpoint não-oficial)
// =============================================================================
// Traduz textos de inglês para português sem necessidade de API key.
// Usado para localizar conteúdo de fontes que publicam apenas em inglês.

const TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single";
const BATCH_MAX_CHARS = 4000; // limite seguro por requisição (URL max ~8192 chars)
const DELAY_MS = 500; // delay entre requisições para evitar rate limit

/**
 * Quebra um texto longo em chunks menores, tentando manter frases inteiras.
 * Se o texto for menor que BATCH_MAX_CHARS, retorna array com 1 elemento.
 *
 * @param {string} text
 * @returns {string[]}
 */
function splitText(text) {
  if (text.length <= BATCH_MAX_CHARS) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > BATCH_MAX_CHARS) {
    // Tenta quebrar no último ponto final, exclamação ou interrogação
    let cutoff = BATCH_MAX_CHARS;
    const slice = remaining.slice(0, BATCH_MAX_CHARS);
    const lastSentence = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? ")
    );

    if (lastSentence > BATCH_MAX_CHARS / 2) {
      cutoff = lastSentence + 1; // inclui o ponto
    } else {
      // Fallback: quebra no último espaço
      const lastSpace = slice.lastIndexOf(" ");
      if (lastSpace > BATCH_MAX_CHARS / 2) {
        cutoff = lastSpace;
      }
    }

    chunks.push(remaining.slice(0, cutoff).trim());
    remaining = remaining.slice(cutoff).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Traduz um único chunk de texto.
 */
async function translateChunk(text, targetLang, sourceLang) {
  const encoded = encodeURIComponent(text);
  const url = `${TRANSLATE_URL}?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encoded}`;

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10_000);

  const resp = await fetch(url, { signal: controller.signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const data = await resp.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error("Formato de resposta inesperado");
  }

  // Concatena todos os segmentos traduzidos
  return data[0]
    .filter((segment) => Array.isArray(segment) && segment[0])
    .map((segment) => segment[0])
    .join("");
}

/**
 * Traduz um texto de inglês para português.
 * Quebra textos longos (>BATCH_MAX_CHARS) em chunks e traduz cada um.
 *
 * @param {string} text — texto em inglês
 * @param {string} [targetLang="pt"] — idioma de destino
 * @param {string} [sourceLang="en"] — idioma de origem
 * @returns {Promise<string>} texto traduzido (ou original se falhar)
 */
async function translateText(text, targetLang = "pt", sourceLang = "en") {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return text;
  }

  // Se o texto já parece estar em português, pula
  if (looksLikePortuguese(text)) {
    return text;
  }

  try {
    // Quebra texto longo em chunks
    const chunks = splitText(text);

    // Traduz cada chunk
    const translatedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      const result = await translateChunk(chunks[i], targetLang, sourceLang);
      translatedChunks.push(result);

      // Delay entre chunks do mesmo texto
      if (i < chunks.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return translatedChunks.join(" ") || text;
  } catch {
    // Falha silenciosa — retorna o texto original
    return text;
  }
}

/**
 * Heurística simples para detectar se um texto já está em português.
 */
function looksLikePortuguese(text) {
  const ptIndicators = [
    /\b(do|da|dos|das|no|na|nos|nas|pelo|pela|com|para|que|não|uma|aqui|são|está|vai|vão|tem|têm|faz|fazem)\b/i,
    /[áàâãéêíóôõúç]/i,
  ];
  return ptIndicators.some((regex) => regex.test(text));
}

/**
 * Traduz múltiplos textos em lote, com delay entre chamadas.
 *
 * @param {string[]} texts — array de textos para traduzir
 * @param {Function} log — função de log
 * @returns {Promise<string[]>} textos traduzidos (mesma ordem)
 */
async function translateBatch(texts, log) {
  const results = [];
  let translated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < texts.length; i++) {
    const original = texts[i];

    if (!original || looksLikePortuguese(original)) {
      results.push(original);
      skipped++;
      continue;
    }

    try {
      const result = await translateText(original);
      results.push(result);
      translated++;
    } catch {
      results.push(original);
      failed++;
    }

    // Delay para não sobrecarregar
    if (i < texts.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  if (log) {
    log("[INFO]", `Tradução: ${translated} ok, ${skipped} puladas, ${failed} falhas`);
  }

  return results;
}

/**
 * Traduz os campos title e description de posts.
 * Modifica os objetos in-place.
 *
 * @param {Array<object>} posts — array de NormalizedPost
 * @param {Function} log — função de log
 * @returns {Promise<Array<object>>} mesmos objetos, com title/description traduzidos
 */
export async function translatePosts(posts, log) {
  if (!posts || posts.length === 0) return posts;

  const titles = posts.map((p) => p.title || "");
  const descriptions = posts.map((p) => p.description || "");

  log("[INFO]", `Traduzindo ${posts.length} posts (en → pt-br)...`);

  const translatedTitles = await translateBatch(titles, null);
  const translatedDescriptions = await translateBatch(descriptions, null);

  for (let i = 0; i < posts.length; i++) {
    if (translatedTitles[i] && translatedTitles[i] !== posts[i].title) {
      posts[i].title = translatedTitles[i];
    }
    if (translatedDescriptions[i] && translatedDescriptions[i] !== posts[i].description) {
      posts[i].description = translatedDescriptions[i];
    }
  }

  log("[OK]", `${posts.length} posts traduzidos`);
  return posts;
}
