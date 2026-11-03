/**
 * Núcleo da Graph API do Instagram. Só usa fetch, então roda igual no Node
 * (MCP) e no Cloudflare Worker (agendador online).
 *
 * Todas as funções recebem `ctx = { token, igUserId, graph }`.
 */

const base = (ctx) => `https://graph.facebook.com/${ctx.graph || "v21.0"}`;

/** Chamada crua à Graph API, com erro legível em vez do JSON bruto da Meta. */
export async function chamar(ctx, caminho, { metodo = "GET", params = {} } = {}) {
  const url = new URL(`${base(ctx)}${caminho}`);
  const corpo = new URLSearchParams();
  const alvo = metodo === "GET" ? url.searchParams : corpo;

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) alvo.set(k, String(v));
  }
  alvo.set("access_token", ctx.token);

  const resp = await fetch(url, {
    method: metodo,
    body: metodo === "GET" ? undefined : corpo,
  });

  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok || dados.error) {
    const e = dados.error || {};
    const err = new Error(
      `Graph API ${resp.status}: ${e.message || "erro desconhecido"}` +
      (e.error_user_msg ? ` — ${e.error_user_msg}` : "") +
      (e.code ? ` (código ${e.code})` : "")
    );
    err.codigo = e.code;
    throw err;
  }
  return dados;
}

// ---------- Publicação ----------

const ehVideo = (url) => /\.(mp4|mov)(\?|$)/i.test(url);

/**
 * Cria um container. tipo:
 *   IMAGE | REELS | STORIES | CAROUSEL_ITEM | CAROUSEL
 */
export async function criarContainer(ctx, { tipo, url, capaUrl, legenda, filhos, noFeed = true }) {
  const p = { caption: legenda || undefined };

  if (tipo === "CAROUSEL") {
    p.media_type = "CAROUSEL";
    p.children = filhos.join(",");
  } else if (tipo === "CAROUSEL_ITEM") {
    p.is_carousel_item = "true";
    p.caption = undefined;
    if (ehVideo(url)) { p.media_type = "VIDEO"; p.video_url = url; }
    else p.image_url = url;
  } else if (tipo === "REELS") {
    p.media_type = "REELS";
    p.video_url = url;
    p.cover_url = capaUrl;
    p.share_to_feed = noFeed ? "true" : "false";
  } else if (tipo === "STORIES") {
    p.media_type = "STORIES";
    p.caption = undefined; // story não tem legenda
    if (ehVideo(url)) p.video_url = url;
    else p.image_url = url;
  } else {
    p.image_url = url;
  }

  const d = await chamar(ctx, `/${ctx.igUserId}/media`, { metodo: "POST", params: p });
  return d.id;
}

/** FINISHED | IN_PROGRESS | ERROR | EXPIRED | PUBLISHED */
export async function statusContainer(ctx, id) {
  const d = await chamar(ctx, `/${id}`, { params: { fields: "status_code,status" } });
  return { codigo: d.status_code, detalhe: d.status };
}

export async function publicarContainer(ctx, creationId) {
  const d = await chamar(ctx, `/${ctx.igUserId}/media_publish`, {
    metodo: "POST",
    params: { creation_id: creationId },
  });
  return d.id;
}

export async function permalink(ctx, mediaId) {
  const d = await chamar(ctx, `/${mediaId}`, { params: { fields: "permalink" } });
  return d.permalink;
}

/** Quantos posts ainda cabem na janela de 24h (limite da Meta). */
export async function cotaPublicacao(ctx) {
  const d = await chamar(ctx, `/${ctx.igUserId}/content_publishing_limit`, {
    params: { fields: "config,quota_usage" },
  });
  const item = (d.data || [])[0] || {};
  return { usado: item.quota_usage ?? 0, total: item.config?.quota_total ?? 50 };
}

// ---------- Leitura e métricas ----------

export async function perfil(ctx) {
  return chamar(ctx, `/${ctx.igUserId}`, {
    params: { fields: "username,followers_count,follows_count,media_count" },
  });
}

/** Posts mais recentes, ou só os publicados entre since e until (segundos Unix). */
export async function postsRecentes(ctx, limite = 10, { since, until } = {}) {
  const d = await chamar(ctx, `/${ctx.igUserId}/media`, {
    params: {
      fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
      limit: limite,
      since,
      until,
    },
  });
  return d.data || [];
}

export async function storiesAtivos(ctx) {
  const d = await chamar(ctx, `/${ctx.igUserId}/stories`, {
    params: { fields: "id,media_type,permalink,timestamp" },
  });
  return d.data || [];
}

const METRICAS = {
  REELS: ["views,reach,saved,shares,likes,comments,total_interactions,ig_reels_avg_watch_time", "views,reach,saved,shares", "reach"],
  STORY: ["views,reach,replies,shares,navigation", "views,reach,replies", "reach"],
  FEED: ["views,reach,saved,shares,likes,comments,total_interactions,profile_visits,follows", "views,reach,saved,shares,total_interactions", "reach,saved", "reach"],
};

/**
 * A Meta recusa o lote inteiro se UMA métrica não valer para o tipo de mídia,
 * então tentamos listas cada vez menores.
 */
export async function metricasDoPost(ctx, mediaId, produto = "FEED") {
  for (const metric of METRICAS[produto] || METRICAS.FEED) {
    try {
      const d = await chamar(ctx, `/${mediaId}/insights`, { params: { metric } });
      return Object.fromEntries(
        (d.data || []).map((m) => [m.name, m.values?.[0]?.value ?? m.total_value?.value ?? 0])
      );
    } catch { continue; }
  }
  return null;
}

/** Números da conta num período (máx. 30 dias). */
/**
 * Números da conta num período. Aceita `dias` (últimos N dias) ou { since, until } em segundos.
 * A Meta limita cada consulta a 30 dias, então períodos maiores são somados em blocos.
 * Atenção: alcance e contas engajadas somados por bloco podem contar a mesma pessoa mais de uma vez.
 */
export async function metricasDaConta(ctx, dias = 7, faixa) {
  const fimTotal = faixa?.until ?? Math.floor(Date.now() / 1000);
  const iniTotal = faixa?.since ?? fimTotal - dias * 86400;
  const BLOCO = 30 * 86400;
  if (fimTotal - iniTotal > BLOCO) {
    const blocos = [];
    for (let ini = iniTotal; ini < fimTotal; ini += BLOCO) {
      blocos.push(metricasDaConta(ctx, 0, { since: ini, until: Math.min(ini + BLOCO, fimTotal) }));
    }
    const res = {};
    for (const b of await Promise.all(blocos)) {
      for (const [k, v] of Object.entries(b)) res[k] = (res[k] ?? 0) + v;
    }
    return res;
  }
  const until = fimTotal;
  const since = iniTotal;
  const nomes = ["reach", "views", "accounts_engaged", "total_interactions", "profile_links_taps", "follows_and_unfollows"];
  const valores = await Promise.all(nomes.map(async (metric) => {
    try {
      const d = await chamar(ctx, `/${ctx.igUserId}/insights`, {
        params: { metric, period: "day", metric_type: "total_value", since, until },
      });
      const m = (d.data || [])[0];
      return m ? m.total_value?.value ?? 0 : undefined;
    } catch { return undefined; } // métrica indisponível para a conta
  }));
  return Object.fromEntries(nomes.map((n, i) => [n, valores[i]]).filter(([, v]) => v !== undefined));
}

// ---------- Comentários (exige instagram_manage_comments) ----------

export async function comentarios(ctx, mediaId, limite = 25) {
  const d = await chamar(ctx, `/${mediaId}/comments`, {
    params: {
      fields: "id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp}",
      limit: limite,
    },
  });
  return d.data || [];
}

export async function responderComentario(ctx, commentId, mensagem) {
  const d = await chamar(ctx, `/${commentId}/replies`, { metodo: "POST", params: { message: mensagem } });
  return d.id;
}

export async function ocultarComentario(ctx, commentId, ocultar = true) {
  await chamar(ctx, `/${commentId}`, { metodo: "POST", params: { hide: ocultar ? "true" : "false" } });
}

export async function apagarComentario(ctx, commentId) {
  await chamar(ctx, `/${commentId}`, { metodo: "DELETE" });
}
