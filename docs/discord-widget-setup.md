# Discord widget setup guide

The Discord widget and its inline English/pt-BR guide are implemented locally.

## Placement

In the dashboard, choose **Add → Discord server**. Paste a server ID or widget JSON URL, choose **Load server**, then **Add widget**. Loading the preview does not publish it. Existing widgets autosave edits and can be moved, hidden, or removed like other entries.

The website shows **Set up your Discord widget** above the source field, open by default for new widgets. Three numbered steps cover server settings, enabling the widget and copying the server ID. **Open Discord** opens a separate tab; **Enter server ID** collapses the guide and focuses the field. Existing widgets start with the guide collapsed, and it reopens for invalid input or a disabled widget. Toggling the guide preserves the entered value. Invite links and HTML embed code are not accepted as widget sources.

Server data is cached for 15 minutes, so online counts and member lists are not live. The space stores the server ID and item settings, without storing member presence in history. No new credentials or database migration are needed.

## English

### Set up your Discord widget

1. Open Discord on desktop or in your browser. Open your server's **Server Settings → Engagement**, scroll down to **Server Widget**, and turn on **Enable Server Widget**. You need permission to manage the server.
2. Choose an **Invite Channel** if you want a **Join server** button, then save your changes.
3. Copy the **Server ID** from the widget settings. If you cannot find it, enable **Developer Mode** under **User Settings → Advanced**, then right-click the server icon and choose **Copy Server ID**. [Discord's ID guide](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID)

No bot or secret key is needed. Enabling the widget makes its server information available publicly, including online members and public voice/stage channels. It does not expose chat messages. [Discord's widget documentation](https://docs.discord.com/developers/resources/guild#guild-widget-object)

### Check the widget

Replace `SERVER_ID` below with your server ID and open the address:

```text
https://discord.com/api/guilds/SERVER_ID/widget.json
```

You should see data containing your server's name. This is the widget URL to use, not a `discord.gg` invite or the HTML embed code.

## Português (Brasil)

### Configure seu widget do Discord

1. Abra o Discord no computador ou navegador. Vá em **Configurações do servidor → Engajamento**, role até **Widget do servidor** e ative o widget. Você precisa ter permissão para gerenciar o servidor.
2. Escolha um **Canal de convite** se quiser exibir o botão **Entrar no servidor** e salve as alterações.
3. Copie o **ID do servidor** nas configurações do widget. Se não encontrar, ative o **Modo de desenvolvedor** em **Configurações de usuário → Avançado**. Depois, clique com o botão direito no ícone do servidor e escolha **Copiar ID do servidor**. [Guia de IDs do Discord](https://support.discord.com/hc/pt-br/articles/206346498-Where-can-I-find-my-User-Server-Message-ID)

Não precisa de bot nem chave secreta. Ao ativar o widget, informações do servidor ficam disponíveis publicamente, incluindo membros online e canais públicos de voz/palco. As mensagens não são exibidas. [Documentação do widget](https://docs.discord.com/developers/resources/guild#guild-widget-object)

### Confira o widget

Substitua `SERVER_ID` pelo ID do seu servidor e abra o endereço:

```text
https://discord.com/api/guilds/SERVER_ID/widget.json
```

Você deve ver dados com o nome do seu servidor. Use esse endereço, não um convite `discord.gg` nem o código HTML de incorporação.

## Help states for the editor

| Situation | English | Português (Brasil) |
| --- | --- | --- |
| Invite pasted | Use a server ID or widget JSON URL, not an invite link or embed code. | Use o ID do servidor ou a URL JSON do widget, não um link de convite ou código de incorporação. |
| Widget disabled | Enable Server Widget in Discord, then try again. | Ative o widget do servidor no Discord e tente novamente. |
| No invite returned | Choose an Invite Channel in Discord to show a Join server button. | Escolha um canal de convite no Discord para exibir o botão Entrar no servidor. |
| Temporary failure | Could not load Discord right now. Try again shortly. | Não foi possível carregar o Discord agora. Tente novamente em instantes. |

Discord can rename settings or limit the returned member list. The online count comes from Discord's presence total, not the number of displayed members. A failed request shows an unavailable state instead of a misleading zero count.
