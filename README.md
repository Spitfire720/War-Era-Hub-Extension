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

