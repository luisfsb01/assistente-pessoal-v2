---
title: Sincronizar Obsidian entre VPS, Windows e iPhone
aliases:
  - Configurar Syncthing no Obsidian
tags:
  - obsidian
  - syncthing
  - windows
  - iphone
  - vps
status: instrucoes
---

# Sincronizar Obsidian entre VPS, Windows e iPhone

Este guia configura a sincronização do cofre do assistente entre:

- VPS: `/root/assistente-vault`
- Aplicativo na VPS: `/vault`
- Windows: `C:\Users\LUIS BARBOSA\assistente-vault`
- iPhone: `No Meu iPhone/Obsidian/Assistente Vault`

O Syncthing mantém os arquivos iguais entre a VPS e o Windows. No iPhone, o aplicativo Möbius Sync funciona como cliente do Syncthing.

> [!warning] Atenção
> Sincronização não substitui backup. Faça uma cópia do cofre antes de conectar um aparelho novo.

## 1. Fazer uma cópia de segurança na VPS

Abra o terminal da VPS e execute:

```bash
cp -a /root/assistente-vault /root/assistente-vault-backup-2026-07-18
```

## 2. Conferir o Syncthing da VPS

No terminal da VPS:

```bash
systemctl status syncthing@root --no-pager
```

Se aparecer como inativo:

```bash
systemctl restart syncthing@root
```

No firewall da Hostinger:

- Porta `22000`, TCP e UDP: manter liberada.
- Porta `8384`, TCP: liberar temporariamente, preferencialmente apenas para o próprio endereço IP.

No computador, abrir:

```text
http://IP-DA-VPS:8384
```

Na interface do Syncthing da VPS:

- [ ] Entrar com o usuário e a senha configurados.
- [ ] Confirmar que existe uma pasta chamada `vault`.
- [ ] Confirmar que o caminho é `/root/assistente-vault`.
- [ ] Abrir **Actions → Show ID**.
- [ ] Copiar o Device ID da VPS ou deixar o QR Code aberto.

## 3. Instalar o Syncthing no Windows

1. Abrir a página de [downloads do Syncthing](https://syncthing.net/downloads/).
2. Escolher **Syncthing Windows Setup**.
3. Baixar o instalador em [Syncthing Windows Setup — versão mais recente](https://github.com/Bill-Stewart/SyncthingWindowsSetup/releases/latest).
4. Instalar para **Current User/Usuário atual**.
5. Manter marcadas as opções para:
   - Iniciar o Syncthing ao entrar no Windows.
   - Criar a regra no Firewall do Windows.
   - Iniciar o Syncthing depois da instalação.
   - Abrir a página de configuração.

A interface local será aberta em:

```text
http://localhost:8384
```

## 4. Conectar o Windows à VPS

Na interface do Syncthing do Windows:

1. Clicar em **Add Remote Device**.
2. Colar o Device ID da VPS.
3. Dar ao dispositivo o nome `VPS Assistente`.
4. Salvar.

Na interface do Syncthing da VPS:

1. Aceitar a solicitação do computador.
2. Dar ao aparelho o nome `Windows Luis`.
3. Abrir a pasta `vault` e clicar em **Edit**.
4. Abrir a aba **Sharing**.
5. Marcar `Windows Luis`.
6. Salvar.

No Windows aparecerá um aviso informando que a VPS quer compartilhar a pasta `vault`:

1. Clicar em **Add**.
2. Em **Folder Path**, informar:

```text
C:\Users\LUIS BARBOSA\assistente-vault
```

3. Manter **Folder Type** como **Send & Receive**.
4. Salvar.
5. Aguardar aparecer **Up to Date** em verde.

Confirmar no Explorador de Arquivos que existem:

```text
C:\Users\LUIS BARBOSA\assistente-vault\Sources
C:\Users\LUIS BARBOSA\assistente-vault\Wiki
```

## 5. Abrir o cofre no Obsidian do Windows

1. Instalar o [Obsidian para Windows](https://obsidian.md/download).
2. Abrir o Obsidian.
3. Escolher **Open folder as vault/Abrir pasta como cofre**.
4. Selecionar:

```text
C:\Users\LUIS BARBOSA\assistente-vault
```

5. Confirmar a abertura.
6. Começar pela nota `Wiki/Index.md`.

> [!important]
> Não criar outro cofre separado. A pasta sincronizada já é o cofre do Obsidian.

## 6. Preparar o iPhone

Instalar:

- [Obsidian](https://apps.apple.com/app/obsidian-connected-notes/id1557175442)
- [Möbius Sync](https://apps.apple.com/app/m%C3%B6bius-sync/id1539203216)

Para sincronizar diretamente com a pasta local do Obsidian, é necessário desbloquear no Möbius Sync a sincronização ilimitada por compra única. A versão gratuita permite somente até 20 MB dentro da pasta do próprio Möbius.

No iPhone:

1. Abrir o Obsidian.
2. Criar um cofre chamado `TEMP`.
3. Desativar **Store in iCloud/Armazenar no iCloud**.
4. Confirmar a criação.

Isso fará o iOS criar a estrutura:

```text
No Meu iPhone → Obsidian → TEMP
```

Não apagar o cofre `TEMP` ainda.

## 7. Conectar o Möbius Sync à VPS

No Möbius Sync:

1. Abrir as configurações.
2. Escolher a opção para adicionar um dispositivo remoto.
3. Escanear o QR Code do Device ID da VPS ou colar o código.
4. Dar ao dispositivo o nome `VPS Assistente`.
5. Salvar.

Na interface do Syncthing da VPS:

1. Aceitar o novo dispositivo.
2. Dar ao aparelho o nome `iPhone Luis`.
3. Abrir a pasta `vault`.
4. Entrar em **Edit → Sharing**.
5. Marcar `iPhone Luis`.
6. Salvar.

## 8. Escolher a pasta correta no iPhone

Quando o Möbius avisar que a VPS compartilhou a pasta `vault`:

1. Tocar para adicionar a pasta.
2. Manter **Folder Type** como **Send & Receive**.
3. Em **Folder Path**, tocar em **Pick External Folder**.
4. Navegar até:

```text
No Meu iPhone → Obsidian
```

5. Dentro de `Obsidian`, criar a pasta `Assistente Vault`.
6. Selecionar a pasta `Assistente Vault`.
7. Salvar.
8. Manter o Möbius aberto e o iPhone carregando até aparecer **Up to Date**.

Não selecionar:

- iCloud Drive.
- A pasta `TEMP`.
- A pasta interna do Möbius Sync.

O destino correto é:

```text
No Meu iPhone → Obsidian → Assistente Vault
```

## 9. Abrir o cofre no Obsidian do iPhone

Depois que o Möbius mostrar **Up to Date**:

1. Abrir o aplicativo **Arquivos**.
2. Entrar em `No Meu iPhone → Obsidian → Assistente Vault`.
3. Confirmar que as pastas `Sources` e `Wiki` estão presentes.
4. Fechar completamente o Obsidian e abri-lo novamente.
5. Entrar em **Gerenciar cofres**.
6. Selecionar `Assistente Vault`.
7. Abrir o cofre.
8. Somente depois de confirmar que tudo funciona, excluir o cofre `TEMP`.

## 10. Rotina de uso no iPhone

Como o iOS limita a sincronização em segundo plano, usar esta sequência:

1. Abrir o Möbius Sync.
2. Esperar aparecer **Up to Date**.
3. Abrir o Obsidian e consultar ou editar as notas.
4. Voltar ao Möbius Sync.
5. Esperar novamente aparecer **Up to Date**.

> [!tip]
> Evite editar a mesma nota simultaneamente no Windows e no iPhone.

## 11. Finalizar a configuração

Depois que Windows e iPhone estiverem sincronizando:

- [ ] Criar uma nota de teste no Windows.
- [ ] Confirmar que ela aparece no iPhone.
- [ ] Editar a nota no iPhone.
- [ ] Abrir o Möbius e esperar **Up to Date**.
- [ ] Confirmar a alteração no Windows e na VPS.
- [ ] Fechar novamente a porta `8384` no firewall da VPS.
- [ ] Manter a porta `22000` TCP e UDP liberada.

## Referências

- [Documentação inicial do Syncthing](https://docs.syncthing.net/intro/getting-started.html)
- [Downloads oficiais do Syncthing](https://syncthing.net/downloads/)
- [Perguntas frequentes do Möbius Sync](https://mobiussync.com/faq/)
- [Obsidian: sincronizar notas entre dispositivos](https://obsidian.md/help/sync-notes)
