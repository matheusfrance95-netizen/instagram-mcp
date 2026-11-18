# Como conectar o Instagram (Meta)

O caminho que funciona, tela a tela. A documentação da Meta não descreve
essa sequência em lugar nenhum. Nos exemplos abaixo, troque pelos seus nomes:

| Item | Exemplo usado aqui |
|---|---|
| Página do Facebook | *Minha Página* |
| Conta Instagram | *@meu.perfil* |
| Portfólio empresarial | *Meu Portfólio* |
| App | *Meu Publicador* |
| Usuário do sistema | *Publicador* |
| Token | usuário do sistema, **nunca expira** |

## A sequência

### 1. Pré-requisitos na conta
- Instagram em modo **Business/Criador**
- Vinculado a uma **Página do Facebook**

A conta do Instagram **não** precisa ser um ativo independente do portfólio.
Ela é alcançada através da Página — o código lê `instagram_business_account`
de cada Página retornada por `/me/accounts`.

### 2. App no Meta for Developers
- **Criar app** → caso de uso **Gerenciamento de conteúdo**
- Marcar **Gerenciar mensagens e conteúdo no Instagram** e **Gerenciar tudo na sua Página**
- Nome do app não pode conter "Instagram", "Facebook" ou "Meta" — a Meta recusa

### 3. Configuração do Login do Facebook para Empresas
Menu lateral do app → **Login do Facebook para empresas** → **Configurações**
(o segundo item com esse nome, entre *Início rápido* e *Modelos* — a tradução
colapsou *Settings* e *Configurations* na mesma palavra).

→ **Criar configuração** → tipo **Token de acesso do usuário do sistema**
→ ativos: **Páginas** e **Contas do Instagram** → permissões disponíveis.

> Essa configuração acabou **não sendo necessária** para o token de sistema.
> Ela governa o fluxo de login interativo. Criamos mesmo assim para não deixar
> o app pela metade.

### 4. Usuário do sistema — a parte que importa
Em **business.facebook.com/settings**, portfólio **Meu Portfólio**:

**Usuários → Usuários do sistema → Adicionar** (`Publicador`, Administrador)

Depois **Atribuir ativos**, nesta ordem exata:

```
1. Páginas            → Minha Página           → Controle total
2. Apps               → Meu Publicador         → Controle total
3. Contas do Instagram → @meu.perfil           → Controle total
```

**A ordem não é opcional.** Sem o app atribuído (passo 2), a tela de gerar
token mostra "Nenhuma permissão disponível". A conta do Instagram (passo 3)
só fica marcável depois que o app está vinculado.

### 5. Gerar o token
**Gerar token** → app **Meu Publicador** → expiração **Nunca** → permissões:

```
instagram_basic
instagram_content_publish
instagram_manage_insights
pages_show_list
pages_read_engagement
```

> ⚠️ Se a lista vier vazia logo após atribuir os ativos, **recarregue a página**
> (F5). O assistente usa dados em cache e foi exatamente isso que travou aqui.

### 6. Gravar no projeto
```bash
npm run token -- <TOKEN>
```

Descobre o `IG_USER_ID` e grava tudo no `.env`. Token de sistema não aceita
troca por token longo — o script detecta isso e segue.

## Armadilhas encontradas

| Sintoma | Causa |
|---|---|
| "Nenhuma configuração disponível" no Graph API Explorer | Login para Empresas exige configuração criada antes |
| Só `business_management` e `pages_show_list` na lista | ativo *Contas do Instagram* não marcado |
| "Nenhuma permissão disponível" ao gerar token | app não atribuído ao usuário do sistema |
| Lista continua vazia após atribuir o app | cache da página; F5 resolve |
| Caixa da conta do Instagram travada | app ainda não vinculado ao usuário do sistema |
| Nome do app recusado | continha "Instagram" |

## Renovação

Não há. O token nunca expira.

Se precisar revogar: **Business Settings → Usuários do sistema → Publicador
→ Anular tokens**. Isso invalida o token atual; gere outro e rode
`npm run token -- <NOVO>`.

## Comentários (responder, ocultar, apagar)

Exige a permissão **`instagram_manage_comments`**, que o token atual não tem.

1. developers.facebook.com → app **Meu Publicador** → Casos de uso → adicione
   `instagram_manage_comments` (se não aparecer na lista).
2. business.facebook.com → Configurações → Usuários do sistema → **Gerar token**
   novamente, marcando as permissões de antes **mais** `instagram_manage_comments`.
3. Grave e atualize a nuvem:
   ```bash
   npm run token -- <TOKEN NOVO>
   npm run deploy
   ```

## Direct automático por palavra-chave (vigia)

O vigia (`ligar_vigia_comentarios`) lê os comentários e manda **um direct** para quem
comentou a palavra combinada, pela *resposta privada* da Meta. Precisa de:

1. **No app do Instagram (celular):** Configurações → Mensagens e respostas aos stories →
   Ferramentas conectadas → ativar **Permitir acesso às mensagens**.
2. **developers.facebook.com → app Meu Publicador → Casos de uso → Gerenciar mensagens e
   conteúdo no Instagram → Personalizar:** confira que estas permissões estão adicionadas:
   `instagram_manage_comments`, `instagram_manage_messages`, `pages_manage_metadata`.
3. **business.facebook.com → Usuários do sistema → Publicador → Gerar token** (expiração
   **Nunca**), marcando as permissões de antes **mais** as três acima:
   ```
   instagram_basic
   instagram_content_publish
   instagram_manage_insights
   instagram_manage_comments
   instagram_manage_messages
   pages_show_list
   pages_read_engagement
   pages_manage_metadata
   ```
4. Grave e atualize a nuvem:
   ```bash
   npm run token -- <TOKEN NOVO>
   npm run deploy
   ```
5. **Teste antes de valer:** ligue um vigia, comente a palavra com **outra conta** e
   espere até 5 minutos. `ver_vigias` mostra se o direct saiu ou o erro.

| Sintoma no `ver_vigias` | Causa |
|---|---|
| erro (#10) ou (#200) de permissão | falta permissão no token, ou o app precisa de **Acesso Avançado** a `instagram_manage_messages` (análise do app pela Meta) para falar com quem não tem função no app |
| erro (#551) ou "não disponível" | a pessoa não aceita mensagens, ou o passo 1 não foi feito |
| "fora da janela" | comentário com mais de 7 dias |

Regras da Meta: **uma** resposta privada por comentário, só até 7 dias depois dele.
Depois disso, só quando a pessoa responder (aí abre a janela normal de 24 h).
