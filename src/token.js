#!/usr/bin/env node
/**
 * Valida o token do .env, descobre o IG_USER_ID e grava tudo.
 *
 * Aceita os dois tipos:
 *  - token de usuário comum  → troca por um de ~60 dias
 *  - token de usuário do sistema → já é permanente, usa como está
 *
 * Uso:  npm run token -- <TOKEN>
 *       npm run token            (lê o que já está no .env)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { tokenLongo, descobrirContas } from "./meta.js";

const entrada = process.argv[2] || config.token;

if (!entrada) {
  console.error("❌ Passe o token:  npm run token -- EAAxxxxx");
  console.error("   Ou cole em META_ACCESS_TOKEN no .env e rode sem argumento.");
  process.exit(1);
}

let token = entrada;
let permanente = false;

// Token de sistema não aceita troca; a recusa da Meta é o sinal de que já é permanente.
if (config.appId && config.appSecret) {
  try {
    console.log("🔄 Tentando trocar por token de longa duração...");
    const r = await tokenLongo(entrada);
    token = r.token;
    if (r.expiraEm) {
      const dias = Math.round(r.expiraEm / 86400);
      const vence = new Date(Date.now() + r.expiraEm * 1000);
      console.log(`✅ Token de ${dias} dias (vence em ${vence.toLocaleDateString("pt-BR")}).`);
    } else {
      permanente = true;
      console.log("✅ Token sem data de expiração.");
    }
  } catch (e) {
    console.log(`ℹ️  Troca não se aplica (${e.message.split("\n")[0]}).`);
    console.log("   Seguindo com o token como veio — é o esperado para token de sistema.");
    permanente = true;
  }
} else {
  console.log("ℹ️  Sem APP_ID/APP_SECRET no .env; usando o token como veio.");
}

console.log("🔎 Procurando contas Instagram Business...");
const contas = await descobrirContas(token);

if (contas.length === 0) {
  console.error(
    "\n❌ Nenhuma conta IG Business encontrada com esse token.\n" +
    "   Verifique:\n" +
    "   • a conta é Business/Criador e está vinculada a uma Página?\n" +
    "   • o token tem instagram_basic e pages_show_list?\n" +
    "   • se for token de sistema: a Página e a conta do Instagram foram\n" +
    "     atribuídas como ativos a esse usuário do sistema?"
  );
  process.exit(1);
}

contas.forEach((c, i) => console.log(`   ${i + 1}. @${c.usuario}  (Página: ${c.pagina})  id=${c.igUserId}`));

const escolhida = contas[0];
if (contas.length > 1) {
  console.log(`\n⚠️ Mais de uma conta. Usando a primeira (@${escolhida.usuario}).`);
  console.log("   Para trocar, edite IG_USER_ID no .env.");
}

const envPath = path.join(config.raiz, ".env");
let conteudo = await fs.readFile(envPath, "utf8");
const definir = (chave, valor) => {
  const linha = `${chave}=${valor}`;
  const re = new RegExp(`^${chave}=.*$`, "m");
  conteudo = re.test(conteudo) ? conteudo.replace(re, linha) : `${conteudo}\n${linha}`;
};
definir("META_ACCESS_TOKEN", token);
definir("IG_USER_ID", escolhida.igUserId);
await fs.writeFile(envPath, conteudo, "utf8");

console.log(`\n✅ .env atualizado — @${escolhida.usuario}, id ${escolhida.igUserId}.`);
if (permanente) console.log("   Token permanente: não precisa renovar.");
