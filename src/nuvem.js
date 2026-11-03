/**
 * Cliente do agendador online (Cloudflare Worker).
 * Envia as mídias, cria publicações (agora ou agendadas) e consulta a agenda.
 */
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { config } from "./config.js";

const IMAGENS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VIDEOS = new Set([".mp4", ".mov"]);

export function exigirNuvem() {
  if (!config.workerUrl || !config.workerKey) {
    throw new Error("Faltam WORKER_URL e WORKER_API_KEY no .env. Veja a seção \"Agendador online\" do README.");
  }
}

async function pedir(caminho, { metodo = "GET", corpo, tipo } = {}) {
  exigirNuvem();
  const r = await fetch(`${config.workerUrl}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${config.workerKey}`,
      ...(tipo ? { "Content-Type": tipo } : {}),
    },
    body: corpo,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `Worker respondeu ${r.status}`);
  return dados;
}

/**
 * Envia um arquivo. Imagens viram JPEG (a Meta só aceita JPEG) e no máximo
 * 1440 px de largura; vídeos vão como estão.
 */
export async function enviarArquivo(arquivo) {
  const ext = path.extname(arquivo).toLowerCase();
  let corpo, nome;
  if (IMAGENS.has(ext)) {
    corpo = await sharp(arquivo)
      .rotate()
      .resize({ width: 1440, withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    nome = path.basename(arquivo, path.extname(arquivo)) + ".jpg";
  } else if (VIDEOS.has(ext)) {
    corpo = await fs.readFile(arquivo);
    nome = path.basename(arquivo);
  } else {
    throw new Error(`Formato não suportado: ${arquivo}`);
  }
  return pedir(`/midia/${encodeURIComponent(nome)}`, { metodo: "PUT", corpo });
}

export const ehVideo = (f) => VIDEOS.has(path.extname(f).toLowerCase());
export const ehMidia = (f) => IMAGENS.has(path.extname(f).toLowerCase()) || ehVideo(f);

/** Cria a publicação. Sem `quando`, publica na hora. */
export async function criarTrabalho({ tipo, arquivos, capa, legenda, quando, noFeed, rotulo, musica }) {
  const midias = [];
  for (const a of arquivos) midias.push(await enviarArquivo(a));
  const capaEnviada = capa ? await enviarArquivo(capa) : undefined;

  return pedir("/trabalhos", {
    metodo: "POST",
    tipo: "application/json",
    corpo: JSON.stringify({
      tipo, midias, capa: capaEnviada, legenda, noFeed, rotulo, musica,
      quando: quando ? quando.toISOString() : undefined,
    }),
  });
}

export const listarTrabalhos = () => pedir("/trabalhos");
export const verTrabalho = (id) => pedir(`/trabalhos/${id}`);
export const cancelarTrabalho = (id) => pedir(`/trabalhos/${id}`, { metodo: "DELETE" });
export const saude = () => pedir("/saude");
