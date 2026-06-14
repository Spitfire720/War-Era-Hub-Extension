# WarEraHub v30 — Player Combat Stats + Bounty Profit Estimator 2.0

## Objetivo
Melhorar a tab **Missões** para responder melhor à pergunta: **vale a pena gastar HP nesta bounty?**

## O que entrou

- A extensão tenta capturar stats de combate na battle page via DOM.
- O `page-hook.js` também calcula stats aproximadas a partir de `inventory.equippedItems` quando disponível.
- O Hub passa a ler `combatStats` antes de cair nos valores antigos de skills.
- O painel **Estado do jogador** mostra mais informação:
  - HP disponível
  - hits possíveis
  - ataque / precisão
  - crítico
  - defesa / esquiva / loot
  - dano estimado total
- Cards de bounty mostram estimativa melhorada:
  - hits possíveis
  - dano estimado total
  - dano estimado por hit
  - moedas estimadas
  - aviso quando o pool limita o ganho

## Ficheiros alterados

- `src/App.jsx`
- `extension/page-hook.js`
- `extension/content-warera.js`
- `extension/content-hub.js`
- `README.md`

## Como aplicar

Substitui os ficheiros pelos nomes exatos incluídos no zip.

Depois:

```bash
npm run dev
```

E faz reload da extensão em:

```text
chrome://extensions
```

## Como testar

1. Abre WarEra.
2. Vai a Battles.
3. Entra numa batalha ou mantém a lista aberta até os dados carregarem.
4. Volta ao Hub.
5. Clica **Recarregar dados locais**.
6. Abre **Missões**.

Confirma:

- Estado do jogador aparece com HP/hits.
- Ataque e precisão aparecem se a extensão/API conseguir ler.
- Bounty mostra estimativa com a tua vida.
- Se não houver stats suficientes, o card pede para abrir battle/sincronizar.

## Nota

O cálculo continua a ser uma estimativa. O dano real no WarEra depende de crítico, miss, armadura, bónus, munição, estado da arma/equipamento e RNG.
