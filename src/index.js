#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { config, ctx, exigirCredenciais } from "./config.js";
import { listarPosts } from "./posts.js";
import { publicar, descreverTrabalho, lerQuando } from "./publicar.js";
import * as nuvem from "./nuvem.js";
import * as g from "./graph.js";

// Regra do dono da conta: nada é escrito nos comentários sem uma ordem dele.
const REGRA_COMENTARIOS =
  "REGRA OBRIGATÓRIA: nunca responda, oculte ou apague comentários por conta própria. " +
  `Só faça isso quando ${config.dono} pedir explicitamente, para aquele comentário, ` +
  "e siga exatamente a orientação (o que dizer e como). Ler e listar comentários é livre. " +
  "Não sugira automação de respostas nem responda em lote sem ordem expressa.";

// O MCP não tem acesso ao Google; quem cria o evento é o Claude, pelo conector do Google Agenda.
const CALENDARIO = config.agendaId
  ? `no calendário "${config.agendaNome}" (id ${config.agendaId})`
  : `no calendário "${config.agendaNome}" (ache o id com list_calendars; se não existir, use o calendário principal)`;
const REGRA_AGENDA =
  "GOOGLE AGENDA (se o conector do Google Agenda estiver disponível): sempre que um post for AGENDADO, crie um evento " +
  CALENDARIO + ", fuso America/Sao_Paulo, início no horário do post e fim 15 min depois. " +
  "Título: \"📸 <Tipo>: <rótulo>\", ou \"🎵 Adicionar música: <música> — <rótulo>\" se o post tiver música. " +
  "Descrição: tipo, horário, primeira linha da legenda, o que fazer (se tiver música: abrir o post no app → ··· → Editar → Adicionar música → <música>) " +
  "e no fim a linha \"instagram-id: <id>\". " +
  "Lembretes (overrideReminders, method popup): 60 minutos e 1 minuto antes; se tiver música, também 0 minutos (na hora da publicação). " +
  "Ao CANCELAR um agendamento, busque o evento por \"instagram-id: <id>\" e apague. Ao publicar na hora (sem agendar), não crie evento. " +
  "DEPOIS QUE O POST SUBIR: apague o evento do Google Agenda. Sempre que usar este MCP, rode listar_agendamentos com todos=true e, " +
  "para cada item \"publicado\", busque \"instagram-id: <id>\" no Google Agenda e apague o evento se ainda existir.";

const servidor = new McpServer(
  { name: "instagram-mcp", version: "2.1.0" },
  { instructions: REGRA_COMENTARIOS + "\n\n" + REGRA_AGENDA }
);

const ORDEM = z.string().min(5).describe(
  "Copie aqui, palavra por palavra, a instrução do usuário que pediu esta ação neste comentário. " +
  "Se ele não pediu, NÃO chame esta ferramenta."
);

const texto = (s) => ({ content: [{ type: "text", text: s }] });
const erro = (e) => ({ content: [{ type: "text", text: `❌ ${e.message}` }], isError: true });
const ferramenta = (nome, def, fn) =>
  servidor.registerTool(nome, def, async (args) => {
    try { return texto(await fn(args ?? {})); } catch (e) { return erro(e); }
  });

const ORIGEM = z.string().describe(
  "Nome de uma pasta de post (procurada na pasta do Google Drive, se DRIVE_DIR estiver no .env, e em posts/; " +
  "ex: \"evolução de obra\" acha \"Carrossel - Evolucao de Obra\"), ou caminho completo de uma pasta ou arquivo. " +
  "Pastas do Drive são apagadas sozinhas depois que o post sobe."
);
const LEGENDA = z.string().optional().describe("Legenda. Se omitida, usa o legenda.txt da pasta.");
const MUSICA = z.string().optional().describe(
  "Música que o usuário vai adicionar pelo app depois de publicar (a API não coloca música). Vira lembrete no painel e no Google Agenda."
);
const QUANDO = z.string().optional().describe(
  "Para agendar: data e hora de Brasília, ex: 2026-11-05T18:00. Omita para publicar agora."
);

// ---------- Publicar / agendar ----------

ferramenta("publicar_carrossel", {
  title: "Publicar ou agendar carrossel",
  description:
    "Carrossel no feed com 2 a 10 imagens e/ou vídeos, na ordem do nome do arquivo. PNG vira JPG automaticamente. Informe `quando` para agendar.",
  inputSchema: { origem: ORIGEM, legenda: LEGENDA, quando: QUANDO, musica: MUSICA },
}, async (a) => descreverTrabalho(await publicar({ tipo: "carrossel", ...a })));

ferramenta("publicar_imagem", {
  title: "Publicar ou agendar imagem única",
  description: "Uma imagem no feed. PNG vira JPG automaticamente. Informe `quando` para agendar.",
  inputSchema: { origem: ORIGEM, legenda: LEGENDA, quando: QUANDO, musica: MUSICA },
}, async (a) => descreverTrabalho(await publicar({ tipo: "imagem", ...a })));

ferramenta("publicar_reels", {
  title: "Publicar ou agendar Reels",
  description:
    "Um vídeo .mp4/.mov (H.264, 9:16, 3 s a 15 min). Numa pasta, um arquivo capa.jpg vira a capa. Informe `quando` para agendar.",
  inputSchema: {
    origem: ORIGEM,
    legenda: LEGENDA,
    quando: QUANDO,
    capa: z.string().optional().describe("Caminho de uma imagem de capa (opcional)"),
    musica: MUSICA,
    no_feed: z.boolean().optional().describe("Também aparecer na grade do perfil (padrão: sim)"),
  },
}, async (a) => descreverTrabalho(await publicar({ tipo: "reels", ...a, noFeed: a.no_feed })));

ferramenta("publicar_story", {
  title: "Publicar ou agendar Story",
  description:
    "Uma imagem ou vídeo nos Stories (ideal 1080x1920). A API não permite stickers, links nem enquetes. Informe `quando` para agendar.",
  inputSchema: { origem: ORIGEM, quando: QUANDO },
}, async (a) => descreverTrabalho(await publicar({ tipo: "story", ...a })));

// ---------- Agenda ----------

const ICONE = { pendente: "⏳", filhos: "🔄", processando: "🔄", publicado: "✅", falhou: "❌" };
const NOME_TIPO = { carrossel: "Carrossel", imagem: "Imagem", reels: "Reels", story: "Story" };

ferramenta("listar_agendamentos", {
  title: "Listar agendamentos",
  description: "Mostra a agenda online: posts pendentes, em processamento, publicados e com falha (últimos 30 dias).",
  inputSchema: {
    todos: z.boolean().optional().describe("Incluir publicados e com falha (padrão: só os pendentes)"),
  },
}, async ({ todos = false }) => {
  let itens = await nuvem.listarTrabalhos();
  if (!todos) itens = itens.filter((i) => !["publicado", "falhou"].includes(i.estado));
  if (itens.length === 0) return todos ? "Agenda vazia." : "Nenhum post pendente. Use `todos: true` para ver o histórico.";
  return itens.map((i) =>
    `${ICONE[i.estado] || "•"} [${i.id}] ${NOME_TIPO[i.tipo]} "${i.rotulo || ""}" — ${new Date(i.quando).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` +
    (i.link ? `\n   ${i.link}` : "") +
    (i.erro ? `\n   erro: ${i.erro}` : "")
  ).join("\n");
});

ferramenta("cancelar_agendamento", {
  title: "Cancelar agendamento",
  description: "Remove um post da agenda (e apaga as mídias da nuvem) pelo id. Depois, apague o evento correspondente no Google Agenda.",
  inputSchema: { id: z.string().describe("Id de 8 caracteres mostrado em listar_agendamentos") },
}, async ({ id }) => {
  await nuvem.cancelarTrabalho(id);
  return `🗑️ Agendamento ${id} cancelado.`;
});

// ---------- Métricas ----------

const n = (v) => (v === undefined || v === null ? "—" : Number(v).toLocaleString("pt-BR"));

ferramenta("ler_metricas", {
  title: "Métricas dos posts",
  description:
    "Posts recentes (feed e Reels) com curtidas, comentários, visualizações, alcance, salvamentos e compartilhamentos. Inclui os Stories ativos (últimas 24h).",
  inputSchema: { limite: z.number().int().min(1).max(25).default(5).describe("Quantos posts recentes") },
}, async ({ limite = 5 }) => {
  exigirCredenciais();
  const c = ctx();
  const blocos = [];

  for (const p of await g.postsRecentes(c, limite)) {
    const produto = p.media_product_type === "REELS" ? "REELS" : "FEED";
    const m = (await g.metricasDoPost(c, p.id, produto)) || {};
    const tipo = produto === "REELS" ? "🎬 Reels" : p.media_type === "CAROUSEL_ALBUM" ? "🖼️ Carrossel" : "📷 Imagem";
    blocos.push(
      `${tipo} · ${new Date(p.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}\n` +
      `   ${(p.caption || "(sem legenda)").split("\n")[0].slice(0, 70)}\n` +
      `   👁️ ${n(m.views)} views · 👤 ${n(m.reach)} alcance · ❤️ ${n(p.like_count)} · 💬 ${n(p.comments_count)} · 🔖 ${n(m.saved)} · ↗️ ${n(m.shares)}` +
      (m.profile_visits !== undefined ? ` · 🔎 ${n(m.profile_visits)} visitas ao perfil` : "") +
      (m.ig_reels_avg_watch_time !== undefined ? ` · ⏱️ ${(m.ig_reels_avg_watch_time / 1000).toFixed(1)}s médio` : "") +
      `\n   id ${p.id} · ${p.permalink}`
    );
  }

  const stories = await g.storiesAtivos(c).catch(() => []);
  for (const s of stories) {
    const m = (await g.metricasDoPost(c, s.id, "STORY")) || {};
    blocos.push(
      `📱 Story · ${new Date(s.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}\n` +
      `   👁️ ${n(m.views)} views · 👤 ${n(m.reach)} alcance · 💬 ${n(m.replies)} respostas · ↗️ ${n(m.shares)}`
    );
  }
  return blocos.join("\n\n") || "Nenhum post encontrado.";
});

ferramenta("metricas_conta", {
  title: "Métricas da conta",
  description: "Seguidores e números do perfil num período: alcance, visualizações, contas engajadas, interações, cliques no link e seguidores ganhos.",
  inputSchema: { dias: z.number().int().min(1).max(30).default(7).describe("Período em dias (máx. 30)") },
}, async ({ dias = 7 }) => {
  exigirCredenciais();
  const c = ctx();
  const [p, m] = await Promise.all([g.perfil(c), g.metricasDaConta(c, dias)]);
  return (
    `@${p.username}\n` +
    `👥 ${n(p.followers_count)} seguidores · segue ${n(p.follows_count)} · ${n(p.media_count)} posts\n\n` +
    `Últimos ${dias} dias:\n` +
    `   👤 Alcance: ${n(m.reach)}\n` +
    `   👁️ Visualizações: ${n(m.views)}\n` +
    `   🙋 Contas engajadas: ${n(m.accounts_engaged)}\n` +
    `   ❤️ Interações: ${n(m.total_interactions)}\n` +
    `   🔗 Cliques em links do perfil: ${n(m.profile_links_taps)}\n` +
    `   ➕ Seguidores (saldo): ${n(m.follows_and_unfollows)}`
  );
});

// ---------- Comentários ----------

const dica = (e) => {
  if (/permission|permiss|\(#10\)|\(#200\)|código (10|200)\b/i.test(e.message)) {
    e.message += "\n\nFalta a permissão instagram_manage_comments no token. Veja SETUP-META.md, seção \"Comentários\".";
  }
  throw e;
};

ferramenta("listar_comentarios", {
  title: "Listar comentários",
  description: "Comentários (e respostas) de um post, ou dos posts mais recentes se nenhum id for informado.",
  inputSchema: {
    post_id: z.string().optional().describe("Id do post (aparece em ler_metricas). Omita para ver os posts recentes."),
    posts: z.number().int().min(1).max(10).default(3).describe("Sem post_id: quantos posts recentes olhar"),
  },
}, async ({ post_id, posts = 3 }) => {
  exigirCredenciais();
  const c = ctx();
  const alvos = post_id
    ? [{ id: post_id }]
    : (await g.postsRecentes(c, posts)).filter((p) => p.comments_count > 0);
  if (alvos.length === 0) return "Nenhum comentário nos posts recentes.";

  const blocos = [];
  for (const p of alvos) {
    const lista = await g.comentarios(c, p.id).catch(dica);
    const titulo = p.caption ? `"${p.caption.split("\n")[0].slice(0, 50)}"` : `post ${p.id}`;
    const linhas = lista.map((k) =>
      `• [${k.id}] @${k.username}${k.hidden ? " (oculto)" : ""}: ${k.text}` +
      (k.replies?.data || []).map((r) => `\n    ↳ [${r.id}] @${r.username}: ${r.text}`).join("")
    );
    blocos.push(`💬 ${titulo}\n${linhas.join("\n") || "  (sem comentários)"}`);
  }
  return blocos.join("\n\n");
});

ferramenta("responder_comentario", {
  title: "Responder comentário",
  description: "Publica uma resposta a um comentário. A resposta fica pública e assinada pelo perfil. " + REGRA_COMENTARIOS,
  inputSchema: {
    ordem_do_usuario: ORDEM,
    comentario_id: z.string().describe("Id do comentário (aparece em listar_comentarios)"),
    mensagem: z.string().min(1).max(2200),
  },
}, async ({ comentario_id, mensagem }) => {
  exigirCredenciais();
  const id = await g.responderComentario(ctx(), comentario_id, mensagem).catch(dica);
  return `✅ Resposta publicada (id ${id}).`;
});

ferramenta("ocultar_comentario", {
  title: "Ocultar ou mostrar comentário",
  description: "Oculta um comentário do público (o autor continua vendo). Use ocultar=false para voltar a mostrar. " + REGRA_COMENTARIOS,
  inputSchema: { ordem_do_usuario: ORDEM, comentario_id: z.string(), ocultar: z.boolean().default(true) },
}, async ({ comentario_id, ocultar = true }) => {
  exigirCredenciais();
  await g.ocultarComentario(ctx(), comentario_id, ocultar).catch(dica);
  return ocultar ? "🙈 Comentário oculto." : "👀 Comentário visível de novo.";
});

ferramenta("apagar_comentario", {
  title: "Apagar comentário",
  description: "Apaga um comentário de vez. Não tem volta. " + REGRA_COMENTARIOS,
  inputSchema: { ordem_do_usuario: ORDEM, comentario_id: z.string() },
}, async ({ comentario_id }) => {
  exigirCredenciais();
  await g.apagarComentario(ctx(), comentario_id).catch(dica);
  return "🗑️ Comentário apagado.";
});

// ---------- Utilidades ----------

ferramenta("listar_posts", {
  title: "Listar posts prontos",
  description: "Lista as subpastas de posts/ com quantidade de imagens/vídeos e prévia da legenda.",
  inputSchema: {},
}, async () => {
  const posts = await listarPosts();
  if (posts.length === 0) return `Nenhum post em ${config.postsDir}.`;
  return posts.map((p) =>
    p.erro ? `• ${p.nome} — ⚠️ ${p.erro}`
      : `• ${p.nome} — ${p.imagens} imagem(ns), ${p.videos} vídeo(s)` +
        (p.previaLegenda ? `, legenda: "${p.previaLegenda}..."` : ", SEM legenda")
  ).join("\n");
});

ferramenta("status_conta", {
  title: "Status da conta",
  description: "Conta conectada, cota de publicação nas últimas 24h e se o agendador online está no ar.",
  inputSchema: {},
}, async () => {
  exigirCredenciais();
  const c = ctx();
  const [p, cota, nuv] = await Promise.all([
    g.perfil(c),
    g.cotaPublicacao(c),
    nuvem.saude().then((s) => (s.tokenConfigurado ? "✅ no ar" : "⚠️ no ar, mas sem token da Meta")).catch((e) => `❌ ${e.message}`),
  ]);
  const pendentes = await nuvem.listarTrabalhos()
    .then((l) => l.filter((i) => i.estado === "pendente").length).catch(() => "?");
  return (
    `Conta: @${p.username} (${config.igUserId})\n` +
    `Publicações nas últimas 24h: ${cota.usado}/${cota.total}\n` +
    `Agendador online: ${nuv}${config.workerUrl ? ` (${config.workerUrl})` : ""}\n` +
    `Posts agendados pendentes: ${pendentes}`
  );
});

// Mantém compatível com quem chamar agendar_post (ex.: pedidos antigos).
ferramenta("agendar_post", {
  title: "Agendar publicação",
  description: "Atalho: agenda qualquer tipo de post. Equivale a publicar_<tipo> com `quando`.",
  inputSchema: {
    tipo: z.enum(["carrossel", "imagem", "reels", "story"]),
    origem: ORIGEM,
    quando: z.string().describe("Data e hora de Brasília, ex: 2026-11-05T18:00"),
    legenda: LEGENDA,
    musica: MUSICA,
  },
}, async (a) => {
  lerQuando(a.quando); // valida antes de enviar qualquer arquivo
  return descreverTrabalho(await publicar(a));
});

await servidor.connect(new StdioServerTransport());
