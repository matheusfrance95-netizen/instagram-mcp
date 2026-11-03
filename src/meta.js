/** Funções de configuração da conta, usadas pelo `npm run token`. */
import { config } from "./config.js";
import { chamar } from "./graph.js";

const ctx = (token) => ({ token: token ?? config.token, graph: config.graph });

/** Troca um token curto por um de ~60 dias. */
export async function tokenLongo(tokenCurto) {
  const d = await chamar(ctx(tokenCurto), "/oauth/access_token", {
    params: {
      grant_type: "fb_exchange_token",
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: tokenCurto,
    },
  });
  return { token: d.access_token, expiraEm: d.expires_in };
}

/** Descobre a conta IG Business ligada às Páginas do usuário. */
export async function descobrirContas(token) {
  const paginas = await chamar(ctx(token), "/me/accounts", {
    params: { fields: "id,name,access_token,instagram_business_account{id,username}" },
  });
  return (paginas.data || [])
    .filter((p) => p.instagram_business_account)
    .map((p) => ({
      pagina: p.name,
      paginaId: p.id,
      paginaToken: p.access_token,
      igUserId: p.instagram_business_account.id,
      usuario: p.instagram_business_account.username,
    }));
}
