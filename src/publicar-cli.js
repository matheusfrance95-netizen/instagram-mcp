#!/usr/bin/env node
/**
 * Publica pelo terminal, sem passar pelo MCP.
 *
 * Uso:  npm run publicar -- <tipo> <origem> [quando]
 *   tipo:   carrossel | imagem | reels | story
 *   origem: subpasta de posts/ ou caminho de pasta/arquivo
 *   quando: opcional, ex 2026-11-05T18:00 (Brasília) para agendar
 */
import { publicar, descreverTrabalho } from "./publicar.js";
import { resolverOrigem } from "./posts.js";

const [tipo, origem, quando] = process.argv.slice(2);
if (!["carrossel", "imagem", "reels", "story"].includes(tipo) || !origem) {
  console.error("Uso: npm run publicar -- <carrossel|imagem|reels|story> <origem> [quando]");
  process.exit(1);
}

const post = await resolverOrigem(origem);
console.log(`\n📁 ${post.nome} — ${post.arquivos.length} arquivo(s)`);
console.log(`\n📝 Legenda:\n${post.legenda || "(vazia)"}\n`);

// Publicar é irreversível e público; vale uma confirmação explícita.
process.stdout.write(`${quando ? `Agendar para ${quando}` : "Publicar AGORA"} no Instagram? [s/N] `);
const resposta = await new Promise((r) => process.stdin.once("data", (d) => r(String(d).trim().toLowerCase())));
if (resposta !== "s") { console.log("Cancelado."); process.exit(0); }

try {
  console.log("\n☁️  Enviando para a nuvem...\n");
  console.log(descreverTrabalho(await publicar({ tipo, origem, quando })));
} catch (e) {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
}
process.exit(0);
