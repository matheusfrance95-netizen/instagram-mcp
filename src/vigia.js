/**
 * Vigia de palavra-chave nos comentários (roda no Worker, a cada 5 minutos).
 *
 * Para cada comentário novo com a palavra combinada (ex.: "PORTO"):
 *   1. manda UM direct com o texto aprovado (resposta privada da Meta);
 *   2. responde em público com uma frase curta, se configurado.
 *
 * Só existe porque o dono da conta pediu esta automação, com palavra e textos aprovados.
 * Cada vigia vale para uma palavra, tem data de início e de fim (no máximo 7 dias,
 * que é o prazo da Meta para resposta privada) e atende cada pessoa uma vez só.
 */
import * as g from "./graph.js";

const SETE_DIAS = 7 * 86400_000;
const MAX_ACOES_POR_RODADA = 15; // folga para os limites da Meta
const MAX_TENTATIVAS = 3;

const normalizar = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * O comentário "pede" a palavra? Para não mandar direct a quem só citou a palavra
 * no meio de uma opinião ("prédio no porto não!"), vale se:
 *   - a palavra aparece em MAIÚSCULAS (ex.: "PORTO", "quero PORTO"), ou
 *   - o comentário é curto (até 3 palavras) e contém a palavra.
 */
export function comentarioPede(texto, palavra) {
  const p = normalizar(palavra);
  const palavras = normalizar(texto).match(/[a-z0-9]+/g) || [];
  if (!palavras.includes(p)) return false;
  const maiusc = String(texto).normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (new RegExp(`\\b${p.toUpperCase()}\\b`).test(maiusc)) return true;
  return palavras.length <= 3;
}

export function validarVigia(v) {
  if (!v.palavra || !/^[\p{L}\d]{2,30}$/u.test(v.palavra)) throw new Error("palavra: uma palavra só, sem espaço.");
  if (!v.dm || v.dm.length < 10 || v.dm.length > 1000) throw new Error("dm: texto do direct entre 10 e 1000 caracteres.");
  if (v.respostas && (!Array.isArray(v.respostas) || v.respostas.some((r) => !r || r.length > 300))) {
    throw new Error("respostas: lista de frases curtas (até 300 caracteres).");
  }
  if (Date.parse(v.ate) - Date.parse(v.desde) > SETE_DIAS + 60_000) {
    throw new Error("O vigia dura no máximo 7 dias (prazo da Meta para resposta privada).");
  }
}

/** Todos os comentários de um post (segue a paginação até 500). */
async function todosComentarios(ctx, mediaId) {
  const itens = [];
  let d = await g.chamar(ctx, `/${mediaId}/comments`, {
    params: { fields: "id,text,username,timestamp", limit: 100 },
  });
  while (true) {
    itens.push(...(d.data || []));
    const depois = d.paging?.cursors?.after;
    if (!d.paging?.next || !depois || itens.length >= 500) break;
    d = await g.chamar(ctx, `/${mediaId}/comments`, {
      params: { fields: "id,text,username,timestamp", limit: 100, after: depois },
    });
  }
  return itens;
}

/**
 * Uma rodada do vigia. Muda `v` no lugar (tratados, log) e devolve se mudou algo.
 * `meuUsuario` evita responder aos próprios comentários do perfil.
 */
export async function rodarVigia(ctx, v, meuUsuario) {
  const agora = Date.now();
  if (!v.ativo) return false;
  if (agora > Date.parse(v.ate)) { v.ativo = false; v.encerradoEm = new Date().toISOString(); return true; }
  if (agora < Date.parse(v.desde)) return false;

  v.tratados ||= {};
  const pessoasAtendidas = new Set(
    Object.values(v.tratados).filter((t) => t.dm === "ok").map((t) => t.usuario)
  );

  const posts = v.posts?.length
    ? v.posts.map((id) => ({ id }))
    : await g.postsRecentes(ctx, 10, { since: Math.floor(Date.parse(v.desde) / 1000) - 3600 });

  let acoes = 0;
  let mudou = false;
  for (const post of posts) {
    for (const c of await todosComentarios(ctx, post.id)) {
      if (acoes >= MAX_ACOES_POR_RODADA) return mudou;
      const ts = Date.parse(c.timestamp);
      if (ts < Date.parse(v.desde) || agora - ts > SETE_DIAS) continue;
      if (c.username === meuUsuario) continue;
      if (!comentarioPede(c.text, v.palavra)) continue;

      const t = v.tratados[c.id] || { usuario: c.username, texto: String(c.text).slice(0, 200), post: post.id, tentativas: 0 };
      if (t.dm === "ok" || t.dm === "pulado" || t.tentativas >= MAX_TENTATIVAS) continue;

      if (pessoasAtendidas.has(c.username)) {
        t.dm = "pulado"; t.motivo = "pessoa já recebeu o direct";
        v.tratados[c.id] = t; mudou = true; continue;
      }

      acoes++; mudou = true; t.tentativas++;
      try {
        await g.respostaPrivada(ctx, c.id, v.dm);
        t.dm = "ok"; t.dmEm = new Date().toISOString(); delete t.erro;
        pessoasAtendidas.add(c.username);
      } catch (e) {
        t.dm = "erro"; t.erro = e.message.slice(0, 300);
      }

      // Resposta pública só depois do direct entregue, para não prometer o que não chegou.
      if (t.dm === "ok" && v.respostas?.length && !t.publica) {
        const frase = v.respostas[Object.keys(v.tratados).length % v.respostas.length];
        try {
          await g.responderComentario(ctx, c.id, frase);
          t.publica = "ok";
        } catch (e) {
          t.publica = "erro"; t.erroPublica = e.message.slice(0, 300);
        }
      }
      v.tratados[c.id] = t;
    }
  }
  v.ultimaRodada = new Date().toISOString();
  return mudou;
}

/** Resumo legível de um vigia. */
export function resumoVigia(v) {
  const ts = Object.values(v.tratados || {});
  const ok = ts.filter((t) => t.dm === "ok").length;
  const erros = ts.filter((t) => t.dm === "erro");
  return {
    id: v.id, palavra: v.palavra, ativo: v.ativo, desde: v.desde, ate: v.ate,
    ultimaRodada: v.ultimaRodada, directsEnviados: ok,
    comErro: erros.length, ultimoErro: erros.at(-1)?.erro,
    pessoas: ts.filter((t) => t.dm === "ok").map((t) => `@${t.usuario}`),
  };
}
