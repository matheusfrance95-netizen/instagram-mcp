#!/usr/bin/env node
/**
 * Apaga as pastas da "frase do dia" que já foram publicadas no Instagram.
 *
 * Lê o historico.txt da skill frase-do-dia (data | ... | id do agendamento),
 * consulta a agenda online e apaga "<data> - frase" quando o post está "publicado".
 * Só mexe em pastas com esse nome exato, dentro de PASTA_FRASES. Nunca apaga _modelo.
 *
 * Uso: node src/limpar-frases.js   (roda sozinho pelo Agendador do Windows, seg a sex 7h30)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { listarTrabalhos } from "./nuvem.js";

const PASTA_FRASES = "D:\\Corretagem\\Cury\\Arte\\Posts Instagram\\Frases e Datas";
const HISTORICO = "C:\\Users\\mathe\\.claude\\skills\\frase-do-dia\\historico.txt";
const NOME = /^\d{4}-\d{2}-\d{2} - frase$/;

const agora = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

// id -> data, a partir das linhas do histórico que têm id de agendamento
const linhas = (await fs.readFile(HISTORICO, "utf8")).split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
const porId = new Map();
for (const l of linhas) {
  const c = l.split("|").map((s) => s.trim());
  const [data, id] = [c[0], c[c.length - 1]];
  if (/^\d{4}-\d{2}-\d{2}$/.test(data) && /^[0-9a-f]{8}$/.test(id)) porId.set(id, data);
}

const agenda = await listarTrabalhos();
const apagadas = [];
for (const t of agenda) {
  if (t.estado !== "publicado" || !porId.has(t.id)) continue;
  const nome = `${porId.get(t.id)} - frase`;
  if (!NOME.test(nome)) continue;
  const dir = path.join(PASTA_FRASES, nome);
  if (path.dirname(dir) !== PASTA_FRASES) continue; // segurança
  try {
    await fs.access(dir);
  } catch {
    continue; // já apagada
  }
  await fs.rm(dir, { recursive: true, force: true });
  apagadas.push(nome);
}

console.log(`[${agora()}] ${apagadas.length ? "apagadas: " + apagadas.join(", ") : "nada para apagar"}`);
