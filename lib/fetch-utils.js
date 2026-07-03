// =============================================================================
// Fetch Utilities — timeout, retry, backoff
// =============================================================================
// Funções compartilhadas para requisições HTTP resilientes.

/**
 * Cria um AbortController que dispara após `ms` milissegundos.
 *
 * @param {number} ms — timeout em milissegundos
 * @returns {AbortController}
 */
export function timeoutSignal(ms) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error(`Timeout após ${ms}ms`)), ms);
  return controller;
}

/**
 * Aguarda `ms` milissegundos.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Cria uma função `fetchWithRetry` pré-configurada com as opções de fetch
 * de um source config. Cada chamada usa timeout, retry e backoff exponencial.
 *
 * @param {object} fetchConfig — `{ timeoutMs, maxRetries, retryBaseDelayMs }` do source config
 * @param {Function} log — função de log com prefixo do source
 * @returns {Function} — `async (url, headers, opts) => Response`
 */
export function createFetchWithRetry(fetchConfig, log) {
  const {
    timeoutMs = 30_000,
    maxRetries = 3,
    retryBaseDelayMs = 1_000,
  } = fetchConfig;

  /**
   * Executa fetch com retry automático e backoff exponencial.
   *
   * @param {string} url — URL a ser requisitada
   * @param {object} [customHeaders={}] — headers HTTP adicionais
   * @param {object} [customOpts={}] — opções extras de fetch (signal, method, body, etc.)
   * @returns {Promise<Response>} — resposta HTTP (não parseada)
   */
  async function fetchWithRetry(url, customHeaders = {}, customOpts = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log("[INFO]", `Tentativa ${attempt}/${maxRetries} — GET ${url}`);

        const controller = timeoutSignal(timeoutMs);

        const resp = await fetch(url, {
          method: "GET",
          headers: customHeaders,
          signal: controller.signal,
          ...customOpts,
        });

        if (!resp.ok) {
          const body = await resp.text().catch(() => "(sem corpo)");
          throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${body.slice(0, 300)}`);
        }

        log("[OK]", `Resposta recebida (${attempt}/${maxRetries})`);
        return resp;

      } catch (err) {
        lastError = err;

        if (err.name === "AbortError") {
          log("[WARN]", `Timeout na tentativa ${attempt}`);
        } else {
          log("[ERROR]", `Falha na tentativa ${attempt}: ${err.message}`);
        }

        if (attempt < maxRetries) {
          const delay = retryBaseDelayMs * Math.pow(2, attempt - 1);
          log("[INFO]", `Aguardando ${delay}ms antes da próxima tentativa...`);
          await sleep(delay);
        }
      }
    }

    throw new Error(
      `Todas as ${maxRetries} tentativas falharam. Último erro: ${lastError?.message}`
    );
  }

  return fetchWithRetry;
}
