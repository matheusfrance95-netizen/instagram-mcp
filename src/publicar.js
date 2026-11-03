import { config, ctx, exigirCredenciais } from "./config.js";
import * as drive from "./drive.js";
import { resolverOrigem } from "./posts.js";
import * as nuvem from "./nuvem.js";
import { cotaPublicacao } from "./graph.js";

const BRASILIA = "America/Sao_Paulo";

/** "2026-11-05T18:00" é lido como horário de Brasília (o Brasil não tem horário de verão). */
export function lerQuando(quando) {
  if (!quando) return null;
  const temFuso = /([zZ]|[+-]\d\d:?\d\d)$/.test(quando);
  const d = new Date(temFuso ? quando : `${quando.length === 16 ? quando + ":00" : quando}-03:00`);
  if (Number.isNaN(d.getTime())) throw new Error(`Data inválida: "${quando}". Use algo como 2026-11-05T18:00.`);
  if (d.getTime() < Date.now() - 60_000) throw new Error(`"${quando}" já passou.`);
  return d;
}

/**
 * Envia as mídias para a nuvem e cria a publicação.
 * Sem `quando`, publica na hora e espera terminar (vídeos podem levar alguns minutos).
 */
export async function publicar({ tipo, origem, legenda, quando, capa, noFeed, musica }) {
  exigirCredenciais();
  nuvem.exigirNuvem();

  const data = lerQuando(quando);
  const post = await resolverOrigem(origem);

  if (!data) {
    const cota = await cotaPublicacao(ctx());
    if (cota.usado >= cota.total) {
      throw new Error(`Cota de publicação esgotada (${cota.usado}/${cota.total} nas últimas 24h).`);
    }
  }

  let t = await nuvem.criarTrabalho({
    tipo,
    arquivos: post.arquivos,
    capa: capa ?? (tipo === "reels" ? post.capa : undefined),
    legenda: tipo === "story" ? "" : (legenda ?? post.legenda),
    quando: data,
    noFeed,
    rotulo: post.nome,
    musica,
  });

  // Vídeo publicado agora: o Worker devolve antes de a Meta terminar. Acompanhamos.
  const fim = Date.now() + 4 * 60_000;
  while (!data && !["publicado", "falhou"].includes(t.estado) && Date.now() < fim) {
    await new Promise((r) => setTimeout(r, 10_000));
    t = await nuvem.verTrabalho(t.id);
  }

  // Conteúdo do Drive: apaga quando o post subir (agendado → o painel apaga depois).
  if (drive.dentroDoDrive(post.dir) && post.dir !== config.driveDir) {
    if (t.estado === "publicado") t.driveApagado = await drive.apagarPasta(post.dir).catch(() => false);
    else if (t.estado !== "falhou") await drive.registrarPendente(t.id, post.dir);
  }
  return t;
}

const NOME = { carrossel: "Carrossel", imagem: "Imagem", reels: "Reels", story: "Story" };

export function descreverTrabalho(t) {
  const nome = NOME[t.tipo];
  const qtd = t.midias.length > 1 ? ` (${t.midias.length} mídias)` : "";
  const lembrete = t.musica ? `\n🎵 Lembrete: adicionar a música "${t.musica}" pelo app (··· → Editar).` : "";
  if (t.estado === "publicado") return `✅ ${nome} publicado${qtd}\n\nLink: ${t.link || "(sem link)"}${lembrete}`;
  if (t.estado === "falhou") throw new Error(`${nome} não publicado: ${t.erro}`);
  if (Date.parse(t.quando) > Date.now() + 60_000) {
    const quando = new Date(t.quando).toLocaleString("pt-BR", { timeZone: BRASILIA, dateStyle: "full", timeStyle: "short" });
    return (
      `🗓️ ${nome}${qtd} agendado para ${quando}\nID: ${t.id}${lembrete}\n\n` +
      `A Cloudflare publica sozinha no horário, com o PC desligado.\n\n` +
      `PRÓXIMO PASSO OBRIGATÓRIO: criar o evento no Google Agenda (ver instruções do servidor) ` +
      `com início em ${t.quando}${t.musica ? `, título de música "${t.musica}"` : ""} e "instagram-id: ${t.id}" na descrição.`
    );
  }
  return `🔄 ${nome} enviado; a Meta ainda está processando (comum em vídeo).\nID: ${t.id} — confira em listar_agendamentos daqui a alguns minutos.`;
}
