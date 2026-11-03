#!/usr/bin/env node
/**
 * Prepara o instagram-mcp neste computador. Pode rodar quantas vezes quiser.
 *
 *   npm install
 *   npm run instalar
 *
 * - cria o .env a partir do .env.example e gera a chave do agendador
 * - registra o MCP no Claude Code (todas as pastas)
 * - no Windows: cria os atalhos do painel (área de trabalho e inicialização) e liga o painel
 * - no fim, roda a verificação e mostra o próximo passo
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(raiz, ".env");
const windows = process.platform === "win32";

// 1. .env
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(raiz, ".env.example"), envPath);
  console.log("✅ .env criado a partir do .env.example");
} else {
  console.log("✅ .env já existe (mantido)");
}
let env = fs.readFileSync(envPath, "utf8");
if (/^WORKER_API_KEY=\s*$/m.test(env)) {
  env = env.replace(/^WORKER_API_KEY=\s*$/m, () => `WORKER_API_KEY=${crypto.randomBytes(32).toString("hex")}`);
  fs.writeFileSync(envPath, env);
  console.log("✅ Chave do agendador gerada (WORKER_API_KEY)");
}

// 2. Registrar o MCP no Claude Code
const servidor = path.join(raiz, "src", "index.js");
const claude = spawnSync("claude", ["mcp", "add", "--scope", "user", "instagram", "--", "node", servidor], {
  encoding: "utf8", shell: windows,
});
if (claude.status === 0) {
  console.log("✅ MCP \"instagram\" registrado no Claude Code");
} else if (/already exists/i.test(claude.stderr + claude.stdout)) {
  console.log("✅ MCP \"instagram\" já estava registrado no Claude Code");
} else {
  console.log("⚠️  Não consegui registrar o MCP sozinho. Adicione no .mcp.json da sua pasta de trabalho:");
  console.log(JSON.stringify({ mcpServers: { instagram: { command: "node", args: [servidor] } } }, null, 2));
}

// 3. Atalhos e painel (Windows)
if (windows) {
  const ps = `
    $raiz = '${raiz.replace(/'/g, "''")}'
    $sh = New-Object -ComObject WScript.Shell
    function Atalho($caminho, $arg, $desc) {
      $s = $sh.CreateShortcut($caminho)
      $s.TargetPath = "$env:WINDIR\\System32\\wscript.exe"
      $s.Arguments = '"' + "$raiz\\iniciar-painel.vbs" + '" ' + $arg
      $s.WorkingDirectory = $raiz
      $s.IconLocation = "$raiz\\painel\\agenda.ico,0"
      $s.Description = $desc
      $s.Save()
    }
    Atalho "$([Environment]::GetFolderPath('Desktop'))\\Agenda Instagram.lnk" "abrir" "Painel da agenda e métricas do Instagram"
    Atalho "$([Environment]::GetFolderPath('Startup'))\\Agenda Instagram (servico).lnk" "" "Mantém o painel do Instagram ativo"
    Start-Process wscript.exe -ArgumentList ('"' + "$raiz\\iniciar-painel.vbs" + '"')
  `;
  try {
    execSync(`powershell -NoProfile -Command -`, { input: ps, stdio: ["pipe", "ignore", "pipe"] });
    console.log("✅ Atalho \"Agenda Instagram\" criado na área de trabalho; o painel liga junto com o Windows");
  } catch (e) {
    console.log(`⚠️  Não consegui criar os atalhos: ${e.message}`);
  }
} else {
  console.log("ℹ️  Fora do Windows: ligue o painel com  npm run painel");
}

// 4. Verificação
console.log("\nConferindo o que falta...");
spawnSync(process.execPath, [path.join(raiz, "src", "verificar.js")], { stdio: "inherit" });
