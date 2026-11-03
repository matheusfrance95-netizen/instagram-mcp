/**
 * Publicação como máquina de estados. Cada chamada de `avancar` faz um passo
 * curto e devolve o trabalho atualizado, então dá para continuar no minuto
 * seguinte (útil para vídeos, que a Meta demora a processar).
 *
 * trabalho = {
 *   id, tipo: "carrossel" | "imagem" | "reels" | "story",
 *   midias: [{ chave, url }], capaUrl?, legenda?, noFeed?,
 *   quando (ISO), estado: "pendente" | "filhos" | "processando" | "publicado" | "falhou",
 *   filhos?, pai?, iniciadoEm?, mediaId?, link?, erro?
 * }
 */
import * as g from "./graph.js";

const LIMITE_PROCESSAMENTO_MS = 30 * 60_000;

export const TERMINAIS = new Set(["publicado", "falhou"]);

export function validar(t) {
  const n = t.midias?.length || 0;
  if (!["carrossel", "imagem", "reels", "story"].includes(t.tipo)) throw new Error(`Tipo inválido: ${t.tipo}`);
  if (t.tipo === "carrossel" && (n < 2 || n > 10)) throw new Error(`Carrossel aceita de 2 a 10 mídias (veio ${n}).`);
  if (t.tipo !== "carrossel" && n !== 1) throw new Error(`${t.tipo} aceita exatamente 1 mídia (veio ${n}).`);
  if (t.tipo === "reels" && !/\.(mp4|mov)$/i.test(t.midias[0].chave)) throw new Error("Reels precisa de um vídeo .mp4 ou .mov.");
  if (t.tipo === "imagem" && !/\.jpe?g$/i.test(t.midias[0].chave)) throw new Error("Imagem única precisa ser .jpg.");
}

export async function avancar(ctx, t) {
  try {
    t.iniciadoEm ??= new Date().toISOString();
    if (Date.now() - Date.parse(t.iniciadoEm) > LIMITE_PROCESSAMENTO_MS) {
      throw new Error("A Meta não terminou de processar em 30 min.");
    }

    if (t.estado === "pendente") {
      if (t.tipo === "carrossel") {
        t.filhos ??= [];
        for (const m of t.midias.slice(t.filhos.length)) {
          t.filhos.push(await g.criarContainer(ctx, { tipo: "CAROUSEL_ITEM", url: m.url }));
        }
        t.estado = "filhos";
      } else {
        const tipo = { imagem: "IMAGE", reels: "REELS", story: "STORIES" }[t.tipo];
        t.pai = await g.criarContainer(ctx, {
          tipo, url: t.midias[0].url, capaUrl: t.capaUrl, legenda: t.legenda, noFeed: t.noFeed ?? true,
        });
        t.estado = "processando";
      }
      return t;
    }

    if (t.estado === "filhos") {
      for (const id of t.filhos) {
        const s = await g.statusContainer(ctx, id);
        if (s.codigo === "ERROR" || s.codigo === "EXPIRED") throw new Error(`Item do carrossel falhou: ${s.detalhe || s.codigo}`);
        if (s.codigo !== "FINISHED") return t; // tenta de novo no próximo passo
      }
      t.pai = await g.criarContainer(ctx, { tipo: "CAROUSEL", filhos: t.filhos, legenda: t.legenda });
      t.estado = "processando";
      return t;
    }

    if (t.estado === "processando") {
      const s = await g.statusContainer(ctx, t.pai);
      if (s.codigo === "ERROR" || s.codigo === "EXPIRED") throw new Error(`A Meta recusou a mídia: ${s.detalhe || s.codigo}`);
      if (s.codigo !== "FINISHED") return t;
      t.mediaId = await g.publicarContainer(ctx, t.pai);
      t.link = await g.permalink(ctx, t.mediaId).catch(() => null);
      t.estado = "publicado";
      t.publicadoEm = new Date().toISOString();
      return t;
    }
  } catch (e) {
    t.estado = "falhou";
    t.erro = e.message;
  }
  return t;
}

/** Avança até terminar ou estourar o tempo. Devolve o trabalho no estado final alcançado. */
export async function executar(ctx, t, { limiteMs = 25_000, intervaloMs = 3_000, aoMudar } = {}) {
  const fim = Date.now() + limiteMs;
  while (!TERMINAIS.has(t.estado) && Date.now() < fim) {
    const antes = t.estado;
    t = await avancar(ctx, t);
    if (aoMudar) await aoMudar(t);
    if (!TERMINAIS.has(t.estado) && t.estado === antes) {
      await new Promise((r) => setTimeout(r, intervaloMs));
    }
  }
  return t;
}
