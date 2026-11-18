# instagram-mcp

Servidor MCP para publicar, agendar e medir posts do Instagram
(**carrossel, imagem única, Reels e Story**) e responder comentários.

## Como funciona

```
Claude ─► MCP (seu PC) ─► Worker na Cloudflare ─► Instagram
           envia mídias      guarda no R2 e
           e a legenda       publica no horário
```

- O MCP converte PNG em JPG sozinho (a Meta só aceita JPEG) e envia os arquivos
  para o **R2**, o armazenamento da Cloudflare.
- O **Worker** serve cada arquivo por uma URL secreta, de onde a Meta baixa.
- Um **cron a cada minuto** publica o que venceu, com o **PC desligado**.
  Vídeos que a Meta demora a processar continuam nos minutos seguintes.
- Depois de publicado, as mídias são apagadas da nuvem. O histórico fica 30 dias.

A Graph API não agenda posts orgânicos, por isso o relógio é nosso.

## Instalação

Veja o **[LEIA-ME.md](LEIA-ME.md)**: passo a passo para instalar em outro computador.
A conexão com a Meta está no **[SETUP-META.md](SETUP-META.md)**.
Para conferir o que falta: `npm run verificar`.

## Ferramentas

| Ferramenta | O que faz |
|---|---|
| `publicar_carrossel` | 2 a 10 imagens/vídeos no feed |
| `publicar_imagem` | uma imagem no feed |
| `publicar_reels` | um vídeo como Reels (capa opcional) |
| `publicar_story` | uma imagem ou vídeo nos Stories |
| `listar_agendamentos` | agenda online (pendentes; `todos` mostra o histórico) |
| `cancelar_agendamento` | tira da agenda e apaga as mídias |
| `ler_metricas` | posts e Reels recentes + Stories ativos |
| `metricas_conta` | seguidores, alcance, views, interações do período |
| `listar_comentarios` | comentários e respostas dos posts |
| `responder_comentario` | responde publicamente |
| `ocultar_comentario` / `apagar_comentario` | moderação |
| `listar_posts` | pastas prontas em `posts/` |
| `status_conta` | conta, cota de 24h e saúde do agendador |

**Todas as de publicar aceitam `quando`** (horário de Brasília, ex.
`2026-11-05T18:00`). Sem `quando`, publica na hora.

`origem` pode ser o nome de uma subpasta de `posts/` ou **qualquer caminho**
de pasta ou arquivo, como `C:\Users\mathe\Downloads\Carrosseis\Carrossel X`.

## Conteúdo no OneDrive

Os carrosséis da skill ficam em **C:\Users\mathe\OneDrive\Criação de Conteúdo\Corretagem\Carrosseis**
(`DRIVE_DIR` no `.env`). A pasta está marcada como "só online" (`attrib +U -P`), então o OneDrive
libera o espaço local depois de sincronizar. Qualquer pasta sincronizada serve (antes era o Google Drive em G:).

- A página do carrossel tem o botão **☁️ Enviar para o OneDrive**: grava os slides em JPG
  e o `legenda.txt` direto na pasta, através do painel (que precisa estar no ar).
- O MCP acha a pasta pelo nome: "evolução de obra" → `Carrossel - Evolucao de Obra`.
- Depois que o post sobe, a pasta é apagada do Drive (vai para a lixeira do Drive):
  na hora, se publicou agora; se foi agendado, o painel apaga quando o post aparecer como publicado.
  Só apaga dentro da pasta Carrosseis.

## A pasta de um post

```
Carrossel X/
  slide-01.png      ← entram na ordem do nome (2 vem antes de 10)
  slide-02.png
  legenda.txt       ← opcional
  capa.jpg          ← só no Reels: vira a capa
```

## Agendador online (Cloudflare)

Código em [worker/](worker/). Para publicar ou atualizar:

```bash
npx wrangler login     # uma vez
npm run deploy         # cria o bucket, publica o Worker, grava segredos e WORKER_URL
```

Rode `npm run deploy` de novo se mudar o código ou o token da Meta.
O token fica como **segredo** na Cloudflare, nunca no código.

Plano grátis: R2 com 10 GB e cron a cada minuto, bem acima do necessário.

## Painel no navegador

Atalho **Agenda Instagram** na área de trabalho (ou `npm run painel`) → http://localhost:3333

- **Agenda**: calendário por dia, semana e mês, com detalhes de cada post
- **Métricas**: números da conta (7/14/30 dias), gráfico de views e tabela ordenável dos posts
- **Notificações**: avisos de 5 min a 1 dia antes, e quando um post é publicado ou falha
- **Nova postagem**: abre o VS Code no projeto numa conversa nova do Claude
- Atualiza sozinho: agenda a cada minuto, métricas a cada 10 min

É um **espelho só de leitura**: não publica nem cancela nada. A chave do agendador
fica no servidor local; o navegador recebe só o que é exibido. A janela minimizada
do atalho precisa ficar aberta; fechar ela desliga o painel.

## Publicar pelo terminal

```bash
npm run publicar -- carrossel evolucao-de-obra
npm run publicar -- reels "C:\caminho\video.mp4" 2026-11-05T18:00
```

Pede confirmação `[s/N]` antes de enviar.

## Registrar no Claude Code

Na raiz do projeto, em `.mcp.json`:

```json
{ "mcpServers": { "instagram": { "command": "node", "args": ["instagram-mcp/src/index.js"] } } }
```

## Limites da Meta

- Publicações por 24h: veja `status_conta`
- Imagens: JPEG, proporção entre 4:5 e 1.91:1 (1080x1350 = 4:5)
- Reels: MP4/MOV H.264, 3 s a 15 min, ideal 9:16
- Story: 1080x1920; a API **não** permite stickers, links, enquetes nem música
- Comentários exigem a permissão `instagram_manage_comments` (ver SETUP-META.md)

## Arquivos

```
src/
  index.js        servidor MCP e ferramentas
  graph.js        Graph API (usado pelo MCP e pelo Worker)
  trabalho.js     publicação passo a passo (usado pelo MCP e pelo Worker)
  publicar.js     pasta → nuvem → publicação
  nuvem.js        cliente do Worker + conversão para JPG
  posts.js        leitura de pastas e arquivos
  deploy.js       npm run deploy
  painel.js       servidor do painel (npm run painel)
  token.js        troca e gravação de token
  config.js       leitura do .env
painel/           página do painel (index.html, app.js, estilo.css)
worker/
  src/index.js    Worker: R2, agenda e cron
  wrangler.toml
```
