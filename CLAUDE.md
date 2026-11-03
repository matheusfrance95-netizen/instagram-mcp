# instagram-mcp — instruções para o Claude

## Quando alguém pedir para instalar ou configurar
Guie a pessoa **um passo por vez**, em português simples, sem despejar o guia inteiro.

1. Rode `npm run verificar` e leia o resultado. Ele lista o que funciona e o **próximo passo**.
2. Faça você mesmo o que der para fazer sem a pessoa: `npm install`, `npm run instalar`, `npm run token -- <token>` quando ela colar o token, `npm run deploy` depois do `wrangler login`.
3. O que só ela pode fazer (cliques nos painéis da Meta e da Cloudflare, cartão para o R2, login) você explica em passos curtos e numerados, pedindo um print quando a tela não bater com o esperado.
   - Meta: siga o [SETUP-META.md](SETUP-META.md) na ordem. A ordem de atribuir ativos ao usuário do sistema (Página → App → Instagram) não é opcional. Se a lista de permissões vier vazia, peça F5.
   - Cloudflare: conta → R2 → ativar → subdomínio workers.dev (em Workers & Pages) → `npx wrangler login` → `npm run deploy`.
4. Depois de cada etapa, rode `npm run verificar` de novo e siga para o próximo ❌.
5. No fim, peça para reiniciar o VS Code e teste com a ferramenta `status_conta`.

Itens marcados com ➖ são opcionais (comentários, Google Drive, painel). Ofereça, mas não insista.

## Regras ao usar o MCP
- Comentários: nunca responder, ocultar nem apagar sem pedido explícito do dono, para aquele comentário.
- Publicar é público e não tem volta: confirme o conteúdo, a legenda e o horário antes de publicar ou agendar.
- Horários são de Brasília (`2026-11-05T18:00`).
- As instruções do servidor MCP trazem as regras do Google Agenda; siga-as quando o conector estiver disponível.

## Nunca
- Mostrar, copiar ou commitar o conteúdo do `.env` (token, segredo do app, chave do agendador).
- Commitar `.env`, `drive-pendentes.json`, `posts/*` (exceto `exemplo`) ou `worker/.wrangler/`.
