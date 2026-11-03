import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Lê o .env desta pasta, mesmo se o servidor for iniciado de outro lugar
dotenv.config({ path: path.join(raiz, ".env"), quiet: true });

export const config = {
  raiz,
  appId: process.env.META_APP_ID || "",
  appSecret: process.env.META_APP_SECRET || "",
  token: process.env.META_ACCESS_TOKEN || "",
  igUserId: process.env.IG_USER_ID || "",
  graph: process.env.GRAPH_VERSION || "v21.0",
  postsDir: path.resolve(raiz, process.env.POSTS_DIR || "./posts"),
  porta: Number(process.env.HOST_PORT || 8787),
  workerUrl: (process.env.WORKER_URL || "").replace(/\/+$/, ""),
  workerKey: process.env.WORKER_API_KEY || "",
  // Opcionais: sem eles, cada recurso simplesmente não é usado.
  driveDir: process.env.DRIVE_DIR || "",
  dono: process.env.DONO_NOME || "o dono da conta",
  agendaNome: process.env.GOOGLE_AGENDA_NOME || "Agenda Instagram",
  agendaId: process.env.GOOGLE_AGENDA_ID || "",
  projetoVsCode: process.env.VSCODE_PROJETO || "",
  pendentesDrivePath: path.join(raiz, "drive-pendentes.json"),
};

/** Contexto para as funções de graph.js */
export const ctx = () => ({ token: config.token, igUserId: config.igUserId, graph: config.graph });

/** Falha cedo e com mensagem útil, em vez de deixar a Graph API devolver erro críptico. */
export function exigirCredenciais() {
  const faltando = [];
  if (!config.token) faltando.push("META_ACCESS_TOKEN");
  if (!config.igUserId) faltando.push("IG_USER_ID");
  if (faltando.length) {
    throw new Error(
      `Faltam credenciais no .env: ${faltando.join(", ")}.\n` +
      `Rode "npm run token" para preencher, ou veja SETUP-META.md.`
    );
  }
}
