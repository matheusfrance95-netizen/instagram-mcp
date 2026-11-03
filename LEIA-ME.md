# instagram-mcp — guia de instalação

Publique, agende e acompanhe seus posts do Instagram conversando com o Claude.

- **Publicar e agendar** carrossel, imagem, Reels e Story. O agendamento roda na nuvem, então o post sai **com o computador desligado**.
- **Métricas** dos posts e da conta.
- **Comentários**: ler, responder, ocultar e apagar. Só faz isso quando você pede.
- **Painel no navegador** com calendário (dia, semana e mês), métricas e notificações.
- **Lembretes no Google Agenda**, que chegam no celular.

> **Jeito mais fácil:** abra esta pasta no VS Code com o Claude Code e diga
> **"me ajude a instalar"**. O Claude confere o que falta e te guia passo a passo.

---

## Do que você precisa

| | Para quê | Custo |
|---|---|---|
| Windows 10 ou 11 | o painel e os atalhos são para Windows (o resto funciona em qualquer sistema) | — |
| [Node.js LTS](https://nodejs.org) | rodar o programa | grátis |
| [VS Code](https://code.visualstudio.com) + extensão **Claude Code** | conversar com o Claude | plano do Claude |
| Instagram **Profissional** (Empresa ou Criador) ligado a uma **Página do Facebook** | exigência da Meta para publicar | grátis |
| Conta na [Cloudflare](https://dash.cloudflare.com/sign-up) | agendador online | grátis |
| Google Drive para computador *(opcional)* | guardar os carrosséis na nuvem | grátis |

---

## Passo a passo

### 1. Baixar e instalar
Baixe esta pasta (ou `git clone`), entre nela e dê dois cliques em **`instalar.cmd`**.

Ele instala as dependências, cria o arquivo `.env`, registra o MCP no Claude Code, cria o atalho **Agenda Instagram** na área de trabalho e mostra o que falta.

### 2. Conectar o Instagram (Meta)
Siga o **[SETUP-META.md](SETUP-META.md)**. É a parte mais longa, uns 20 minutos de cliques nos painéis da Meta. No fim você terá um token. Grave-o com:
```
npm run token -- COLE_O_TOKEN
```

### 3. Ligar o agendador online (Cloudflare)
1. Crie a conta grátis na Cloudflare.
2. No painel dela, abra **R2** e clique em **Ativar** (pede cartão, mas o plano grátis não cobra).
3. No painel, vá em **Workers & Pages** e escolha um subdomínio `workers.dev`.
4. No terminal, dentro desta pasta:
   ```
   npx wrangler login
   npm run deploy
   ```

### 4. Conferir
```
npm run verificar
```
Quando tudo estiver ✅, **reinicie o VS Code** e peça ao Claude: *"status da conta do Instagram"*.

---

## Opcionais

- **Comentários:** o token precisa da permissão `instagram_manage_comments` (SETUP-META.md, seção "Comentários").
- **Google Drive:** instale o [Google Drive para computador](https://www.google.com/drive/download/) no modo **streaming**, crie uma pasta para os carrosséis e coloque o caminho em `DRIVE_DIR` no `.env`. O Claude passa a buscar os posts ali e apaga cada pasta depois que o post sobe.
- **Google Agenda:** conecte o Google Agenda no Claude (claude.ai → Configurações → Conectores). Cada post agendado vira um evento com aviso 1 hora e 1 minuto antes. Para usar outro calendário, mude `GOOGLE_AGENDA_NOME` no `.env`.
- **Seu nome:** preencha `DONO_NOME` no `.env`.

---

## Como usar no dia a dia

Peça ao Claude, em português mesmo:

- *"Publica o carrossel evolução de obra agora"*
- *"Agenda esse Reels para sexta às 18h"* (horário de Brasília)
- *"Agenda o carrossel X para amanhã às 12h com a música Y"*: a API não coloca música, então vira um lembrete para você adicionar pelo app
- *"Lista os agendamentos"* e *"cancela o agendamento abc123"*
- *"Como foram meus posts essa semana?"* e *"métricas da conta dos últimos 30 dias"*
- *"Mostra os comentários do último post"*

O **painel** abre pelo atalho **Agenda Instagram**. Ele é só para consulta, liga junto com o Windows e tem o botão **Nova postagem**, que abre o Claude.

---

## Problemas comuns

| Mensagem | O que fazer |
|---|---|
| `Faltam credenciais no .env` | `npm run token -- SEU_TOKEN` |
| `Faltam WORKER_URL e WORKER_API_KEY` | `npm run deploy` |
| `Ative o R2 no painel da Cloudflare` | Cloudflare → R2 → Ativar, e rode o deploy de novo |
| Erro `9004` ao publicar | a imagem precisa ser JPG (o programa converte sozinho; confira se o arquivo abre) |
| Permissão de comentários | SETUP-META.md, seção "Comentários" |
| Painel não abre | dê dois cliques no atalho **Agenda Instagram**, ou rode `npm run painel` |

Em qualquer dúvida, rode `npm run verificar`: ele mostra o próximo passo.

## Segurança

- Os segredos ficam só no `.env`, que **nunca** vai para o git.
- Na Cloudflare, o token da Meta fica guardado como segredo criptografado.
- O agendador online exige a chave (`WORKER_API_KEY`) em todas as ações. As mídias ficam em endereços aleatórios e são apagadas depois que o post sobe.
- O painel só funciona no seu computador e não publica nem cancela nada.

### Ponto de atenção: envio de slides para o Drive
Para o botão **☁️ Enviar para o Google Drive** da skill funcionar, o painel aceita
receber arquivos de **páginas abertas do próprio computador** (`file://`).

- **O que uma página maliciosa aberta no seu PC conseguiria:** gravar uma imagem (`slide-NN.jpg`)
  ou um `legenda.txt` dentro da pasta de carrosséis do Drive (`DRIVE_DIR`).
- **O que ela não consegue:** publicar, agendar ou cancelar posts (isso sempre passa por você e
  pelo Claude), ler seus arquivos, ou gravar fora da pasta de carrosséis ou com outro tipo de arquivo.
- **Como se proteger:** não abra arquivos `.html` de origem desconhecida e confira os slides antes
  de pedir para publicar. Se não usa a skill de carrossel, deixe `DRIVE_DIR` vazio no `.env`:
  o envio fica desligado.

## Licença

[MIT](LICENSE): use, modifique e distribua à vontade, mantendo o aviso de copyright.
