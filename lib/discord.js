// =============================================================================
// Discord Notifier — envia notificações de novos posts via webhook
// =============================================================================
// Formata NormalizedPost como Discord rich embeds e envia via POST.
// Falha nunca interrompe o pipeline principal.

/**
 * Máximo de embeds por mensagem (limite do Discord).
 */
const MAX_EMBEDS_PER_MESSAGE = 10;

/**
 * Máximo de posts novos a notificar por execução (evita spam).
 */
const MAX_NOTIFICATIONS_PER_RUN = 5;

/**
 * Constrói um embed do Discord a partir de um NormalizedPost.
 *
 * @param {object} post — NormalizedPost
 * @param {object} sourceConfig — config completo da source
 * @returns {object} embed object para a API do Discord
 */
function buildEmbed(post, sourceConfig) {
  return {
    title: (post.title || "").substring(0, 256), // limite Discord
    url: post.link || undefined,
    description: (post.description || "").substring(0, 4096), // limite Discord
    color: sourceConfig.discord?.color || 0x5865f2, // blurple default
    timestamp: normalizeIsoDate(post.pubDate),
    footer: {
      text: `${sourceConfig.name} — ${post.categoryLabel || post.category || "News"}`,
    },
    thumbnail: post.thumbnail ? { url: post.thumbnail } : undefined,
    author: {
      name: sourceConfig.name,
      url: sourceConfig.feedMeta?.link || undefined,
    },
    fields: [
      {
        name: "Categoria",
        value: post.categoryLabel || post.category || "News",
        inline: true,
      },
    ],
  };
}

/**
 * Normaliza uma string de data para ISO 8601 (ou undefined se inválida).
 *
 * @param {string} dateStr
 * @returns {string|undefined}
 */
function normalizeIsoDate(dateStr) {
  if (!dateStr) return undefined;
  try {
    const normalized = dateStr.includes("T")
      ? dateStr
      : dateStr.replace(" ", "T") + "Z";
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Envia notificação de novos posts para um canal do Discord via webhook.
 *
 * @param {string|null} webhookUrl — URL completa do webhook (ou null se não configurado)
 * @param {object} sourceConfig — config completo da source
 * @param {Array<object>} newPosts — array de NormalizedPost recém-detectados
 * @param {object} ctx — contexto de log { log(level, ...args) }
 * @returns {Promise<void>}
 */
export async function sendDiscordNotification(webhookUrl, sourceConfig, newPosts, ctx) {
  if (!webhookUrl) {
    ctx.log("[WARN]", "Discord: webhook URL vazia — pulando notificação");
    return;
  }

  if (!newPosts || newPosts.length === 0) {
    return;
  }

  // Limita quantidade para evitar spam
  const postsToNotify = newPosts.slice(0, MAX_NOTIFICATIONS_PER_RUN);

  const embeds = postsToNotify.map((post) => buildEmbed(post, sourceConfig));

  const payload = {
    username: sourceConfig.discord?.username || "Game RSS Bot",
    avatar_url: sourceConfig.discord?.avatarUrl || undefined,
    content:
      postsToNotify.length > 1
        ? `📰 **${postsToNotify.length} novas notícias** de ${sourceConfig.name}`
        : `📰 **Nova notícia** de ${sourceConfig.name}`,
    embeds: embeds.slice(0, MAX_EMBEDS_PER_MESSAGE),
  };

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "(sem corpo)");
      ctx.log(
        "[ERROR]",
        `Discord: webhook falhou — HTTP ${resp.status}: ${body.slice(0, 200)}`
      );
    } else {
      ctx.log("[OK]", `Discord: ${postsToNotify.length} notificação(ões) enviada(s)`);
    }
  } catch (err) {
    // Discord NUNCA interrompe o pipeline
    ctx.log("[ERROR]", `Discord: erro ao enviar — ${err.message}`);
  }
}
