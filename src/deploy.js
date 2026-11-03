#!/usr/bin/env node
/**
 * Publica o agendador online na Cloudflare e liga o MCP a ele.
 * Pode rodar de novo sempre que mudar o código ou o token da Meta.
 *
 *   npm run deploy
 *
 * Antes, uma vez: `npx wrangler login` e ativar o R2 no painel da Cloudflare.
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const workerDir = path.join(config.raiz, "worker");
const envPath = path.join(config.raiz, ".env");
const wrangler = (args, opts = {}) =>
  execSync(`npx wrangler ${args}`, { cwd: workerDir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts });

function segredo(nome, valor) {
  const r = spawnSync("npx", ["wrangler", "secret", "put", nome], {
    cwd: workerDir, input: valor, encoding: "utf8", shell: true,
  });
  if (r.status !== 0) throw new Error(`Falha ao gravar ${nome}: ${r.stderr || r.stdout}`);
}

if (!config.token || !config.workerKey) {
  console.error("❌ Faltam META_ACCESS_TOKEN ou WORKER_API_KEY no .env.");
  process.exit(1);
}

console.log("1/4 Bucket R2...");
try {
  wrangler("r2 bucket create instagram-midia");
} catch (e) {
  const msg = String(e.stderr || e.stdout || e.message);
  if (/already exists|10004/i.test(msg)) console.log("    já existe");
  else if (/enable R2|10042/i.test(msg)) {
    console.error("❌ Ative o R2 no painel da Cloudflare (R2 → Enable/Purchase plan) e rode de novo.");
    process.exit(1);
  } else throw e;
}

console.log("2/4 Publicando o Worker...");
const saida = wrangler(`deploy --var IG_USER_ID:${config.igUserId}`);
const url = saida.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];
if (!url) {
  console.error(saida);
  throw new Error("Não achei a URL do Worker na saída do deploy.");
}

console.log("3/4 Gravando segredos...");
segredo("API_KEY", config.workerKey);
segredo("META_TOKEN", config.token);

console.log("4/4 Salvando WORKER_URL no .env...");
let env = fs.readFileSync(envPath, "utf8");
env = /^WORKER_URL=.*$/m.test(env) ? env.replace(/^WORKER_URL=.*$/m, `WORKER_URL=${url}`) : env + `\nWORKER_URL=${url}\n`;
fs.writeFileSync(envPath, env);

const r = await fetch(`${url}/saude`, { headers: { Authorization: `Bearer ${config.workerKey}` } });
console.log(`\n✅ Agendador no ar: ${url}`);
console.log(`   saúde: ${r.status} ${await r.text()}`);
