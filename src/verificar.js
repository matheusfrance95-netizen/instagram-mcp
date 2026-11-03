#!/usr/bin/env node
/**
 * Confere a instalação e diz qual é o próximo passo.
 *
 *   npm run verificar
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const itens = [];
const marcar = (ok, titulo, detalhe = "", passo = "", opcional = false) =>
  itens.push({ ok, titulo, detalhe, passo, opcional });

async function comTempo(p, ms = 10_000) {
  return Promise.race([p, new Promise((_, n) => setTimeout(() => n(new Error("sem resposta")), ms))]);
}

// 1. Node
const versao = Number(process.versions.node.split(".")[0]);
marcar(versao >= 20, "Node.js 20 ou mais novo", `versão ${process.versions.node}`,
  "Instale o Node.js LTS em https://nodejs.org e abra um terminal novo.");

// 2. Dependências
const temDeps = fs.existsSync(path.join(config.raiz, "node_modules", "sharp"));
marcar(temDeps, "Dependências instaladas", "", "Rode: npm install");

// 3. .env
const temEnv = fs.existsSync(path.join(config.raiz, ".env"));
marcar(temEnv, "Arquivo .env criado", "", "Rode: npm run instalar");

// 4. App Meta
marcar(Boolean(config.appId && config.appSecret), "App da Meta (META_APP_ID e META_APP_SECRET)", "",
  "Crie o app da Meta seguindo o SETUP-META.md (passos 1 a 3) e preencha META_APP_ID e META_APP_SECRET no .env.");

// 5. Token e conta
let usuario = "";
if (config.token && config.igUserId) {
  try {
    const base = `https://graph.facebook.com/${config.graph}`;
    const r = await comTempo(fetch(`${base}/${config.igUserId}?fields=username&access_token=${config.token}`));
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    usuario = d.username;
    marcar(true, "Token da Meta e conta do Instagram", `@${usuario}`);

    const p = await (await comTempo(fetch(`${base}/me/permissions?access_token=${config.token}`))).json();
    const tem = new Set((p.data || []).filter((x) => x.status === "granted").map((x) => x.permission));
    const faltam = ["instagram_basic", "instagram_content_publish", "instagram_manage_insights"].filter((x) => !tem.has(x));
    marcar(!faltam.length, "Permissões de publicar e métricas", faltam.length ? `faltam: ${faltam.join(", ")}` : "",
      "Gere um token novo com as permissões do SETUP-META.md (passo 5) e rode: npm run token -- SEU_TOKEN");
    marcar(tem.has("instagram_manage_comments"), "Permissão de comentários (opcional)", "",
      "Para responder comentários, veja a seção \"Comentários\" do SETUP-META.md.", true);
  } catch (e) {
    marcar(false, "Token da Meta e conta do Instagram", e.message,
      "Gere um token novo (SETUP-META.md, passo 5) e rode: npm run token -- SEU_TOKEN");
  }
} else {
  marcar(false, "Token da Meta e conta do Instagram", "META_ACCESS_TOKEN ou IG_USER_ID vazio",
    "Gere o token (SETUP-META.md, passos 4 e 5) e rode: npm run token -- SEU_TOKEN");
}

// 6. Agendador online
if (config.workerUrl && config.workerKey) {
  try {
    const r = await comTempo(fetch(`${config.workerUrl}/saude`, { headers: { Authorization: `Bearer ${config.workerKey}` } }));
    const d = await r.json();
    marcar(r.ok && d.tokenConfigurado, "Agendador online (Cloudflare)", config.workerUrl,
      "Rode: npm run deploy");
  } catch (e) {
    marcar(false, "Agendador online (Cloudflare)", e.message, "Rode: npm run deploy");
  }
} else {
  marcar(false, "Agendador online (Cloudflare)", "WORKER_URL vazio",
    "Crie uma conta grátis na Cloudflare, ative o R2 e rode: npx wrangler login  e depois  npm run deploy  (README, \"Agendador online\").");
}

// 7. Google Drive (opcional)
if (config.driveDir) {
  marcar(fs.existsSync(config.driveDir), "Pasta do Google Drive (opcional)", config.driveDir,
    "Abra o app Google Drive para computador ou crie a pasta indicada em DRIVE_DIR.", true);
} else {
  marcar(false, "Pasta do Google Drive (opcional)", "DRIVE_DIR vazio",
    "Se for usar a skill de carrossel com o Drive, instale o Google Drive para computador (modo streaming) e preencha DRIVE_DIR.", true);
}

// 8. Painel
const porta = Number(process.env.PAINEL_PORTA || 3333);
try {
  const r = await comTempo(fetch(`http://localhost:${porta}/api/status`), 5000);
  marcar(r.ok, "Painel no navegador (opcional)", `http://localhost:${porta}`, "Rode: npm run instalar (cria os atalhos e liga o painel)", true);
} catch {
  marcar(false, "Painel no navegador (opcional)", "desligado", "Rode: npm run instalar (cria os atalhos e liga o painel)", true);
}

// ---------- Resultado ----------
console.log("\nInstalação do instagram-mcp\n");
for (const i of itens) {
  const icone = i.ok ? "✅" : i.opcional ? "➖" : "❌";
  console.log(`${icone} ${i.titulo}${i.detalhe ? `  (${i.detalhe})` : ""}`);
}
const proximo = itens.find((i) => !i.ok && !i.opcional);
if (proximo) {
  console.log(`\n👉 Próximo passo: ${proximo.passo}\n`);
  process.exitCode = 1;
} else {
  console.log(`\n🎉 Pronto para usar${usuario ? ` com @${usuario}` : ""}. Reinicie o Claude Code e peça: "status da conta do Instagram".\n`);
  const op = itens.filter((i) => !i.ok && i.opcional);
  if (op.length) console.log("Opcionais pendentes:\n" + op.map((i) => `  • ${i.titulo}: ${i.passo}`).join("\n") + "\n");
}
