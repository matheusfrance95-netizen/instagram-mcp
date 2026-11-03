/**
 * Carrosséis no Google Drive (montado em G: no modo streaming).
 *
 * - salvarArquivo: grava o que a página do carrossel envia (slides JPG + legenda).
 * - Depois que o post sobe, a pasta é apagada do Drive (vai para a lixeira do Drive).
 *   Post agendado: a pasta fica registrada em drive-pendentes.json e é apagada
 *   quando a agenda online mostrar o post como publicado.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { listarTrabalhos } from "./nuvem.js";

const NOME_ARQUIVO = /^(slide-\d{2}\.jpg|legenda\.txt)$/;
const LIMITE_BYTES = 15 * 1024 * 1024;

/** "Carrossel Evolução de Obra" → nome de pasta seguro, sem barras nem "..". */
export function nomePasta(nome) {
  // Troca caracteres proibidos, remove pontos soltos ("..") e pontos nas pontas.
  const limpo = String(nome || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .split(/\s+/).filter((p) => !/^\.+$/.test(p)).join(" ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (!limpo || limpo === "." || limpo === "..") throw new Error("Nome de carrossel inválido.");
  return limpo.slice(0, 100);
}

/** Está dentro da pasta de carrosséis do Drive? (nunca apagamos nada fora dela) */
export function dentroDoDrive(dir) {
  if (!config.driveDir) return false;
  const base = path.resolve(config.driveDir) + path.sep;
  return path.resolve(dir).startsWith(base);
}

export async function salvarArquivo(carrossel, arquivo, corpo) {
  if (!config.driveDir) throw new Error("DRIVE_DIR não está configurado no .env do instagram-mcp.");
  if (!NOME_ARQUIVO.test(arquivo)) throw new Error(`Arquivo não aceito: ${arquivo}`);
  if (corpo.length > LIMITE_BYTES) throw new Error("Arquivo grande demais.");
  await fs.access(path.parse(config.driveDir).root).catch(() => {
    throw new Error("O Google Drive (G:) não está conectado. Abra o app Google Drive.");
  });
  const dir = path.join(config.driveDir, nomePasta(carrossel));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, arquivo), corpo);
  return dir;
}

// ---------- Limpeza depois de publicar ----------

async function lerPendentes() {
  try { return JSON.parse(await fs.readFile(config.pendentesDrivePath, "utf8")); } catch { return {}; }
}
const salvarPendentes = (p) => fs.writeFile(config.pendentesDrivePath, JSON.stringify(p, null, 2));

export async function apagarPasta(dir) {
  if (!dentroDoDrive(dir)) return false; // segurança: só a pasta de carrosséis
  await fs.rm(dir, { recursive: true, force: true });
  return true;
}

/** Registra a pasta de um post agendado para apagar quando ele subir. */
export async function registrarPendente(idTrabalho, dir) {
  if (!dentroDoDrive(dir)) return;
  const p = await lerPendentes();
  p[idTrabalho] = dir;
  await salvarPendentes(p);
}

/**
 * Apaga do Drive as pastas dos posts já publicados.
 * Se o agendamento foi cancelado (sumiu da agenda), só esquece o registro e mantém a pasta.
 */
export async function limparPublicados() {
  const p = await lerPendentes();
  const ids = Object.keys(p);
  if (!ids.length) return [];
  const agenda = new Map((await listarTrabalhos()).map((t) => [t.id, t.estado]));
  const apagadas = [];
  for (const id of ids) {
    const estado = agenda.get(id);
    if (estado === "publicado") {
      if (await apagarPasta(p[id])) apagadas.push(p[id]);
      delete p[id];
    } else if (!estado) {
      delete p[id];
    }
  }
  await salvarPendentes(p);
  return apagadas;
}
