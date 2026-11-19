/**
 * Agendador online do instagram-mcp (Cloudflare Worker + R2).
 *
 * - Guarda as mídias no R2 e serve por uma URL pública impossível de adivinhar,
 *   que é de onde a Meta baixa.
 * - Guarda cada publicação como agenda/<id>.json.
 * - A cada minuto (cron) avança o que está vencido e apaga as mídias já publicadas.
 *
 * Segredos (wrangler secret put): API_KEY, META_TOKEN
 * Variáveis (wrangler.toml): IG_USER_ID, GRAPH_VERSION
 */
import { executar, validar, TERMINAIS } from "../../src/trabalho.js";
import { rodarVigia, validarVigia, resumoVigia } from "../../src/vigia.js";
import { perfil } from "../../src/graph.js";

const TIPOS = {
  jpg: "image/jpeg", jpeg: "image/jpeg", mp4: "video/mp4", mov: "video/quicktime",
};
const GUARDAR_HISTORICO_DIAS = 30;

const json = (dados, status = 200) =>
  new Response(JSON.stringify(dados, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const ctxDe = (env) => ({ token: env.META_TOKEN, igUserId: env.IG_USER_ID, graph: env.GRAPH_VERSION });

const aleatorio = () =>
  [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function lerTrabalho(env, id) {
  const o = await env.MIDIA.get(`agenda/${id}.json`);
  return o ? o.json() : null;
}

const salvarTrabalho = (env, t) =>
  env.MIDIA.put(`agenda/${t.id}.json`, JSON.stringify(t), {
    httpMetadata: { contentType: "application/json" },
  });

async function listarTrabalhos(env) {
  const itens = [];
  let cursor;
  do {
    const r = await env.MIDIA.list({ prefix: "agenda/", cursor });
    for (const o of r.objects) {
      const t = await (await env.MIDIA.get(o.key))?.json();
      if (t) itens.push(t);
    }
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return itens.sort((a, b) => a.quando.localeCompare(b.quando));
}

async function lerVigia(env, id) {
  const o = await env.MIDIA.get(`vigias/${id}.json`);
  return o ? o.json() : null;
}

const salvarVigia = (env, v) =>
  env.MIDIA.put(`vigias/${v.id}.json`, JSON.stringify(v), {
    httpMetadata: { contentType: "application/json" },
  });

async function listarVigias(env) {
  const r = await env.MIDIA.list({ prefix: "vigias/" });
  const itens = [];
  for (const o of r.objects) {
    const v = await (await env.MIDIA.get(o.key))?.json();
    if (v) itens.push(v);
  }
  return itens.sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

/** A cada 5 minutos: roda os vigias ativos. Um vigia com erro não derruba os outros. */
async function rodarVigias(env) {
  const ativos = (await listarVigias(env)).filter((v) => v.ativo);
  if (ativos.length === 0) return;
  const ctx = ctxDe(env);
  const eu = (await perfil(ctx)).username;
  for (const v of ativos) {
    try {
      if (await rodarVigia(ctx, v, eu)) await salvarVigia(env, v);
    } catch (e) {
      v.erroRodada = e.message.slice(0, 300);
      v.ultimaRodada = new Date().toISOString();
      await salvarVigia(env, v);
    }
  }
}

async function apagarMidias(env, t) {
  const chaves = [...t.midias.map((m) => m.chave), t.capaChave].filter(Boolean);
  if (chaves.length) await env.MIDIA.delete(chaves);
}

/** Avança um trabalho, salva e limpa as mídias quando termina. */
async function processar(env, t, opcoes) {
  t = await executar(ctxDe(env), t, { ...opcoes, aoMudar: (x) => salvarTrabalho(env, x) });
  await salvarTrabalho(env, t);
  if (TERMINAIS.has(t.estado)) await apagarMidias(env, t);
  return t;
}

async function rotas(req, env) {
  const url = new URL(req.url);
  const partes = url.pathname.split("/").filter(Boolean);

  // Público: a Meta baixa daqui. A chave tem 128 bits aleatórios.
  if (req.method === "GET" && partes[0] === "m") {
    const o = await env.MIDIA.get(partes.join("/"));
    if (!o) return new Response("não encontrado", { status: 404 });
    return new Response(o.body, {
      headers: {
        "Content-Type": o.httpMetadata?.contentType || "application/octet-stream",
        "Content-Length": String(o.size),
        "Cache-Control": "no-store",
      },
    });
  }

  if (req.headers.get("Authorization") !== `Bearer ${env.API_KEY}`) {
    return json({ erro: "não autorizado" }, 401);
  }

  // PUT /midia/<nome-do-arquivo>  → guarda e devolve a URL pública
  if (req.method === "PUT" && partes[0] === "midia" && partes[1]) {
    const nome = decodeURIComponent(partes[1]).replace(/[^\w.-]/g, "_");
    const ext = nome.split(".").pop().toLowerCase();
    if (!TIPOS[ext]) return json({ erro: `Formato não aceito: .${ext}. Use .jpg, .mp4 ou .mov.` }, 400);
    const chave = `m/${aleatorio()}/${nome}`;
    await env.MIDIA.put(chave, req.body, { httpMetadata: { contentType: TIPOS[ext] } });
    return json({ chave, url: `${url.origin}/${chave}` });
  }

  // POST /trabalhos  → publica agora (sem "quando") ou agenda
  if (req.method === "POST" && partes[0] === "trabalhos" && !partes[1]) {
    const b = await req.json();
    const t = {
      id: aleatorio().slice(0, 8),
      tipo: b.tipo,
      midias: b.midias,
      capaUrl: b.capa?.url,
      capaChave: b.capa?.chave,
      legenda: b.legenda || "",
      noFeed: b.noFeed ?? true,
      rotulo: b.rotulo || "",
      musica: String(b.musica || "").slice(0, 200), // lembrete: adicionar pelo app após publicar
      quando: b.quando ? new Date(b.quando).toISOString() : new Date().toISOString(),
      criadoEm: new Date().toISOString(),
      estado: "pendente",
    };
    try { validar(t); } catch (e) { return json({ erro: e.message }, 400); }
    await salvarTrabalho(env, t);

    // Publicar agora: tenta concluir dentro da própria requisição.
    // Se for vídeo e a Meta demorar, o cron termina nos próximos minutos.
    if (Date.parse(t.quando) <= Date.now() + 30_000) {
      return json(await processar(env, t, { limiteMs: 25_000 }));
    }
    return json(t, 201);
  }

  if (partes[0] === "trabalhos" && req.method === "GET" && !partes[1]) {
    return json(await listarTrabalhos(env));
  }

  if (partes[0] === "trabalhos" && partes[1]) {
    const t = await lerTrabalho(env, partes[1]);
    if (!t) return json({ erro: `Nenhum agendamento com id ${partes[1]}.` }, 404);
    if (req.method === "GET") return json(t);
    if (req.method === "DELETE") {
      if (!["pendente", "falhou", "publicado"].includes(t.estado)) {
        return json({ erro: `Não dá para cancelar: já está "${t.estado}" na Meta.` }, 409);
      }
      await apagarMidias(env, t);
      await env.MIDIA.delete(`agenda/${t.id}.json`);
      return json({ ok: true });
    }
  }

  // ---------- Vigias de palavra-chave nos comentários ----------
  if (partes[0] === "vigias" && req.method === "POST" && !partes[1]) {
    const b = await req.json();
    const desde = b.desde ? new Date(b.desde) : new Date();
    const v = {
      id: aleatorio().slice(0, 8),
      palavra: String(b.palavra || "").trim(),
      dm: String(b.dm || ""),
      respostas: (b.respostas || []).map(String).filter(Boolean),
      posts: (b.posts || []).map(String).filter(Boolean),
      travarNoPrimeiro: Boolean(b.travarNoPrimeiro),
      desde: desde.toISOString(),
      ate: (b.ate ? new Date(b.ate) : new Date(desde.getTime() + 7 * 86400_000)).toISOString(),
      rotulo: String(b.rotulo || "").slice(0, 100),
      ativo: true,
      criadoEm: new Date().toISOString(),
      tratados: {},
    };
    try { validarVigia(v); } catch (e) { return json({ erro: e.message }, 400); }
    await salvarVigia(env, v);
    return json(resumoVigia(v), 201);
  }
  if (partes[0] === "vigias" && req.method === "GET" && !partes[1]) {
    return json((await listarVigias(env)).map(resumoVigia));
  }
  if (partes[0] === "vigias" && partes[1]) {
    const v = await lerVigia(env, partes[1]);
    if (!v) return json({ erro: `Nenhum vigia com id ${partes[1]}.` }, 404);
    if (req.method === "GET") return json({ ...resumoVigia(v), dm: v.dm, respostas: v.respostas, tratados: v.tratados });
    if (req.method === "DELETE") {
      v.ativo = false;
      v.encerradoEm = new Date().toISOString();
      await salvarVigia(env, v);
      return json(resumoVigia(v));
    }
  }

  if (req.method === "GET" && partes[0] === "saude") {
    return json({ ok: true, igUserId: env.IG_USER_ID, tokenConfigurado: Boolean(env.META_TOKEN) });
  }

  return json({ erro: "rota não encontrada" }, 404);
}

async function tique(env) {
  const agora = Date.now();
  for (const t of await listarTrabalhos(env)) {
    if (TERMINAIS.has(t.estado)) {
      const ref = Date.parse(t.publicadoEm || t.criadoEm);
      if (agora - ref > GUARDAR_HISTORICO_DIAS * 86400_000) await env.MIDIA.delete(`agenda/${t.id}.json`);
      continue;
    }
    if (Date.parse(t.quando) > agora) continue;
    await processar(env, t, { limiteMs: 20_000 });
  }
}

export default {
  async fetch(req, env) {
    try {
      return await rotas(req, env);
    } catch (e) {
      return json({ erro: e.message }, 500);
    }
  },
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(tique(env));
    if (new Date(evento.scheduledTime).getUTCMinutes() % 5 === 0) ctx.waitUntil(rodarVigias(env));
  },
};

