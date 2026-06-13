# WarEraHub Sync Extension

Extensão local para sincronizar dados do WarEra com o WarEraHub.

## Domínios suportados

Esta versão está preparada para:

- `https://app.warera.io/*`
- `http://localhost/*`
- `http://127.0.0.1/*`
- `https://stellular-gecko-c76cd4.netlify.app/*`
- `https://warerahub.pt/*`
- `https://www.warerahub.pt/*`

## O que sincroniza

- Perfil / skills
- Inventário e recursos
- Market prices
- Empresas
- Estado de sincronização modular

## Segurança

A extensão lê dados que já aparecem na sessão local do jogador no browser.

Não envia cookies, JWTs, passwords ou tokens para um servidor externo.

## Instalação local

1. Faz download deste repositório ou zip.
2. Extrai a pasta.
3. Abre Chrome.
4. Vai a `chrome://extensions`.
5. Liga `Developer mode`.
6. Clica `Load unpacked`.
7. Seleciona a pasta da extensão.
8. Abre WarEra e depois WarEraHub.

## Teste rápido

1. Abre `https://app.warera.io/`.
2. Vai a Profile, Inventory, Market e Companies.
3. Abre o WarEraHub em localhost, Netlify ou `warerahub.pt`.
4. Clica em `Recarregar dados locais`.
5. Confirma que a sincronização mostra ticks para Perfil, Inventário, Market e Empresas.

## Estado

Beta / community testing.
