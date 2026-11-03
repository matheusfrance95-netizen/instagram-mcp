import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { ehMidia, ehVideo } from "./nuvem.js";

/** Ordena 2.png antes de 10.png, que a ordem alfabética erraria. */
const porNomeNatural = (a, b) =>
  a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });

const ehCapa = (nome) => /^(capa|cover)\./i.test(nome);

// "evolução de obra" acha "Carrossel - Evolucao de Obra": ignora acentos, caixa e o prefixo.
const normal = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/^carrossel\s*-?\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();

async function parecidosNoDrive(origem) {
  const alvo = normal(origem);
  if (!alvo || !config.driveDir) return [];
  const pastas = await fs.readdir(config.driveDir, { withFileTypes: true }).catch(() => []);
  return pastas
    .filter((e) => e.isDirectory() && normal(e.name).includes(alvo))
    .map((e) => path.join(config.driveDir, e.name));
}

async function lerLegenda(dir) {
  for (const arquivo of ["legenda.txt", "caption.txt"]) {
    try {
      return (await fs.readFile(path.join(dir, arquivo), "utf8")).trim();
    } catch { /* sem legenda é aceitável */ }
  }
  return "";
}

/**
 * Aceita o nome de uma subpasta de posts/, um caminho de pasta ou um caminho de arquivo.
 * Devolve { nome, dir, arquivos (caminhos completos, ordenados), capa?, legenda }.
 * Numa pasta, um arquivo "capa.jpg" vira a capa do Reels e não entra na lista.
 */
export async function resolverOrigem(origem) {
  const candidatos = path.isAbsolute(origem)
    ? [origem]
    : [
        ...(config.driveDir ? [path.join(config.driveDir, origem), path.join(config.driveDir, `Carrossel - ${origem}`)] : []),
        ...(await parecidosNoDrive(origem)),
        path.join(config.postsDir, origem),
        path.resolve(origem),
      ];

  for (const c of candidatos) {
    const info = await fs.stat(c).catch(() => null);
    if (!info) continue;

    if (info.isFile()) {
      if (!ehMidia(c)) throw new Error(`Formato não suportado: ${c}`);
      const dir = path.dirname(c);
      return { nome: path.basename(c), dir, arquivos: [c], legenda: await lerLegenda(dir) };
    }

    const nomes = (await fs.readdir(c, { withFileTypes: true }))
      .filter((e) => e.isFile() && ehMidia(e.name))
      .map((e) => e.name)
      .sort(porNomeNatural);
    const capa = nomes.find(ehCapa);
    const arquivos = nomes.filter((n) => !ehCapa(n)).map((n) => path.join(c, n));
    if (arquivos.length === 0) throw new Error(`Nenhuma imagem ou vídeo em ${c}`);

    return {
      nome: path.basename(c),
      dir: c,
      arquivos,
      capa: capa ? path.join(c, capa) : undefined,
      legenda: await lerLegenda(c),
    };
  }
  throw new Error(`Não encontrei "${origem}" (nem em ${config.postsDir}).`);
}

/** Lista as pastas de post: primeiro as do Google Drive, depois as de posts/. */
export async function listarPosts() {
  const pastas = [];
  for (const base of [config.driveDir, config.postsDir].filter(Boolean)) {
    const entradas = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
    for (const e of entradas) if (e.isDirectory()) pastas.push({ name: e.name, dir: path.join(base, e.name) });
  }

  const resultado = [];
  for (const e of pastas) {
    try {
      const p = await resolverOrigem(e.dir);
      const videos = p.arquivos.filter(ehVideo).length;
      resultado.push({
        nome: p.nome,
        imagens: p.arquivos.length - videos,
        videos,
        previaLegenda: p.legenda.slice(0, 80),
      });
    } catch {
      resultado.push({ nome: e.name, erro: "sem mídias válidas" });
    }
  }
  return resultado;
}
