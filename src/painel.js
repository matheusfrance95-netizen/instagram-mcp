#!/usr/bin/env node
/**
 * Painel local no navegador: agenda do Instagram em calendário.
 * Fala com o agendador online por aqui, para a chave nunca ir ao navegador.
 *
 *   npm run painel   →  http://localhost:3333
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { config, ctx } from "./config.js";
import * as nuvem from "./nuvem.js";
import * as g from "./graph.js";
import * as drive from "./drive.js";

const PORTA = Number(process.env.PAINEL_PORTA || 3333);
const PASTA = path.join(config.raiz, "painel");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

const json = (res, dados, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(dados));
};

// Métricas fazem uma chamada por post; guardamos 5 min para não gastar a cota da Meta.
const cache = new Map();
async function emCache(chave, fn, ms = 5 * 60_000) {
  const c = cache.get(chave);
  if (c && Date.now() - c.em < ms) return c.valor;
  const valor = await fn();
  cache.set(chave, { em: Date.now(), valor });
  return valor;
}

async function metricas(dias, limite, forcar, faixa) {
  if (forcar) cache.clear();
  const chaveConta = faixa ? `conta-${faixa.de}-${faixa.ate}` : `conta-${dias}`;
  const chavePosts = faixa ? `posts-${faixa.de}-${faixa.ate}` : `posts-${limite}`;
  // Recortes antigos não mudam mais; guardamos por 1 h.
  const validade = faixa ? 60 * 60_000 : undefined;
  const [conta, base] = await Promise.all([
    emCache(chaveConta, () => g.metricasDaConta(ctx(), dias, faixa), validade),
    emCache(chavePosts, () => postsComMetricas(faixa ? 50 : limite, faixa), validade),
  ]);
  const em = Math.min(cache.get(chaveConta).em, cache.get(chavePosts).em);
  const fmt = (s) => s.split("-").reverse().join("/");
  const rotulo = faixa ? `${fmt(faixa.de)} a ${fmt(faixa.ate)}` : `${dias}d`;
  return { ...base, conta, dias, rotulo, faixa: faixa || null, geradoEm: new Date(em).toISOString() };
}

/** "2026-10-01" e "2026-10-31" (horário de Brasília) → segundos Unix, validados. */
function lerFaixa(de, ate) {
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  if (!ok(de) || !ok(ate)) return null;
  const since = Math.floor(Date.parse(`${de}T00:00:00-03:00`) / 1000);
  const until = Math.min(Math.floor(Date.parse(`${ate}T23:59:59-03:00`) / 1000), Math.floor(Date.now() / 1000));
  if (!(since < until)) throw new Error("A data inicial precisa ser antes da final (e não no futuro).");
  if (until - since > 366 * 86400) throw new Error("Escolha no máximo 1 ano por vez.");
  return { de, ate, since, until };
}

async function postsComMetricas(limite, faixa) {
  const c = ctx();
  const [perfil, posts, stories] = await Promise.all([
    g.perfil(c),
    g.postsRecentes(c, limite, faixa ? { since: faixa.since, until: faixa.until } : {}),
    g.storiesAtivos(c).catch(() => []),
  ]);
  const comMetricas = await Promise.all(posts.map(async (p) => {
    const produto = p.media_product_type === "REELS" ? "REELS" : "FEED";
    const m = (await g.metricasDoPost(c, p.id, produto)) || {};
    return {
      link: p.permalink, data: p.timestamp,
      tipo: produto === "REELS" ? "reels" : p.media_type === "CAROUSEL_ALBUM" ? "carrossel" : "imagem",
      legenda: (p.caption || "").split("\n")[0].slice(0, 90),
      curtidas: p.like_count ?? 0, comentarios: p.comments_count ?? 0,
      views: m.views ?? 0, alcance: m.reach ?? 0, salvos: m.saved ?? 0, compart: m.shares ?? 0,
      interacoes: m.total_interactions ?? (p.like_count ?? 0) + (p.comments_count ?? 0),
    };
  }));
  const comStories = await Promise.all(stories.map(async (s) => {
    const m = (await g.metricasDoPost(c, s.id, "STORY")) || {};
    return { data: s.timestamp, views: m.views ?? 0, alcance: m.reach ?? 0, respostas: m.replies ?? 0 };
  }));
  return {
    perfil: { usuario: perfil.username, seguidores: perfil.followers_count, seguindo: perfil.follows_count, posts: perfil.media_count },
    posts: comMetricas, stories: comStories,
  };
}

let ultimaAgenda = new Map();

const limpar = (t) => ({
  id: t.id,
  tipo: t.tipo,
  rotulo: t.rotulo || "",
  musica: t.musica || "",
  legenda: t.legenda || "",
  quando: t.quando,
  estado: t.estado,
  link: t.link || null,
  erro: t.erro || null,
  publicadoEm: t.publicadoEm || null,
  midias: (t.midias || []).map((m) => ({ video: /\.(mp4|mov)$/i.test(m.chave || "") })),
});

async function api(req, res, partes) {
  if (req.method === "GET" && partes[1] === "metricas") {
    const q = new URL(req.url, "http://local").searchParams;
    const dias = Math.min(30, Math.max(1, Number(q.get("dias")) || 7));
    const limite = Math.min(25, Math.max(1, Number(q.get("limite")) || 12));
    let faixa;
    try { faixa = lerFaixa(q.get("de"), q.get("ate")); } catch (e) { return json(res, { erro: e.message }, 400); }
    return json(res, await metricas(dias, limite, q.has("forcar"), faixa));
  }

  // Espelho: só leitura. O navegador recebe o mínimo para exibir, sem chaves,
  // endereço da nuvem, ids internos da Meta nem URLs diretas das mídias.
  if (req.method === "GET" && partes[1] === "agenda") {
    const itens = await nuvem.listarTrabalhos();
    ultimaAgenda = new Map(itens.map((t) => [t.id, t]));
    return json(res, itens.map(limpar));
  }

  // Miniatura repassada pelo servidor local (só enquanto o post não foi publicado).
  if (req.method === "GET" && partes[1] === "midia" && partes[2] && partes[3]) {
    const t = ultimaAgenda.get(partes[2]);
    const m = t?.midias?.[Number(partes[3])];
    if (!m) return json(res, { erro: "sem mídia" }, 404);
    const r = await fetch(m.url);
    if (!r.ok) return json(res, { erro: "mídia indisponível" }, 404);
    res.writeHead(200, { "Content-Type": r.headers.get("content-type") || "image/jpeg", "Cache-Control": "private, max-age=600" });
    return res.end(Buffer.from(await r.arrayBuffer()));
  }

  // Único botão que faz algo: abre o VS Code no projeto, numa conversa nova do Claude Code.
  // Não publica nada; só abre a janela para você pedir o post.
  if (req.method === "POST" && partes[1] === "nova-postagem") {
    if (!req.headers.origin) return json(res, { erro: "origem não permitida" }, 403);
    abrirVsCode();
    return json(res, { ok: true });
  }

  if (req.method !== "GET") return json(res, { erro: "o painel é só leitura" }, 405);

  if (req.method === "GET" && partes[1] === "status") {
    const c = ctx();
    const [perfil, cota] = await Promise.all([g.perfil(c), g.cotaPublicacao(c)]);
    return json(res, { usuario: perfil.username, cota });
  }

  json(res, { erro: "rota não encontrada" }, 404);
}

// Pasta que o botão "Nova postagem" abre no VS Code (VSCODE_PROJETO no .env; padrão: esta pasta).
const PROJETO = config.projetoVsCode || config.raiz;
const PROMPT = "Quero publicar/agendar no Instagram: ";

function abrirVsCode() {
  exec(`code "${PROJETO}"`, () => {
    // Dá tempo da janela do projeto abrir antes de pedir a aba do Claude.
    setTimeout(() => {
      exec(`start "" "vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(PROMPT)}"`);
    }, 2500);
  });
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  const partes = url.pathname.split("/").filter(Boolean);

  const origem = req.headers.origin;

  // Página do carrossel (aberta do disco, origem "null") enviando slides para o Drive.
  // Só aceita slide-NN.jpg e legenda.txt, e só grava na pasta de carrosséis do Drive.
  if (partes[0] === "api" && partes[1] === "drive" && (origem === "null" || !origem)) {
    const cors = {
      "Access-Control-Allow-Origin": "null",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Private-Network": "true",
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    if (req.method === "POST" && partes[2] && partes[3]) {
      try {
        const pedacos = [];
        let total = 0;
        for await (const p of req) {
          total += p.length;
          if (total > 16 * 1024 * 1024) throw new Error("Arquivo grande demais.");
          pedacos.push(p);
        }
        const dir = await drive.salvarArquivo(decodeURIComponent(partes[2]), decodeURIComponent(partes[3]), Buffer.concat(pedacos));
        res.writeHead(200, { ...cors, "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ ok: true, pasta: path.basename(dir) }));
      } catch (e) {
        res.writeHead(400, { ...cors, "Content-Type": "application/json; charset=utf-8" });
        return res.end(JSON.stringify({ erro: e.message }));
      }
    }
  }

  // Fora isso, só aceita chamadas da própria página, nunca de outros sites abertos no navegador.
  if (origem && origem !== `http://localhost:${PORTA}` && origem !== `http://127.0.0.1:${PORTA}`) {
    return json(res, { erro: "origem não permitida" }, 403);
  }

  try {
    if (partes[0] === "api") return await api(req, res, partes);

    const arquivo = path.join(PASTA, path.basename(url.pathname === "/" ? "index.html" : url.pathname));
    const corpo = await fs.readFile(arquivo).catch(() => null);
    if (!corpo) return json(res, { erro: "não encontrado" }, 404);
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arquivo)] || "application/octet-stream" });
    res.end(corpo);
  } catch (e) {
    json(res, { erro: e.message }, 500);
  }
});

// Se o painel já estiver aberto (ex.: atalho clicado duas vezes), só abre o navegador.
servidor.on("error", (e) => {
  // Código 3 avisa o serviço (painel-servico.cmd) que já tem um painel rodando.
  if (e.code === "EADDRINUSE") {
    if (process.argv.includes("--sem-abrir")) process.exit(3);
    exec(`start "" "http://localhost:${PORTA}"`);
    setTimeout(() => process.exit(3), 500);
  } else throw e;
});

// Apaga do Drive o conteúdo dos posts agendados que já subiram.
async function limparDrive() {
  try {
    const apagadas = await drive.limparPublicados();
    for (const d of apagadas) console.log(`🗑️ Drive: apagado ${path.basename(d)} (post publicado)`);
  } catch { /* sem internet ou Drive desconectado: tenta na próxima */ }
}

servidor.listen(PORTA, "127.0.0.1", () => {
  const endereco = `http://localhost:${PORTA}`;
  console.log(`📅 Painel no ar: ${endereco}  (Ctrl+C para fechar)`);
  limparDrive();
  setInterval(limparDrive, 2 * 60_000);
  if (!process.argv.includes("--sem-abrir")) exec(`start "" "${endereco}"`);
});
