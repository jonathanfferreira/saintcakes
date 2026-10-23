---
name: Saint Cakes
description: Sistema de design compartilhado pelo app da equipe e pela página pública de encomendas da Saint Cakes.
colors:
  paper: "#faf7f0"
  ink: "#392317"
  ink-hover: "#4f3322"
  surface: "#fffdf9"
  white: "#fff"
  sunk: "#f3ede2"
  line: "#e5dccd"
  line-strong: "#d6c8b3"
  muted: "#6b5c4c"
  gold: "#936326"
  gold-deep: "#74501e"
  gold-tint: "#f3e8d2"
  gold-on-dark: "#f0d9a8"
  gold-on-dark-hover: "#f7e6c2"
  on-dark-muted: "#e6d9c3"
  on-dark-disabled: "#d9cdb8"
  leaf: "#2f5440"
  leaf-hover: "#264535"
  leaf-tint: "#e6efe7"
  danger: "#9c493b"
  danger-ink: "#7d3426"
  danger-tint: "#f7e8e3"
  danger-border: "#e3c3b9"
  amber: "#7a5414"
  amber-tint: "#f6ead2"
  purple-text: "#5b3f72"
  purple-tint: "#ece4f2"
  disabled-bg: "#e9e1d4"
  disabled-text: "#8a7c6b"
  primary-disabled-bg: "#d9cfbf"
  primary-disabled-text: "#5f5242"
  selection: "#ecd9b4"
  scrollbar: "#cdbfa8"
  bar-fill: "#d9bf8c"
  legacy-account: "#f1eade"
  print-ink: "#222222"
  print-black: "#000000"
  print-rule: "#999999"
  print-hairline: "#cccccc"
typography:
  display:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "clamp(2.6rem, 12vw, 3.2rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "1.35rem"
    fontWeight: 400
    lineHeight: 1.2
  body:
    fontFamily: "Onest Variable, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Onest Variable, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1
  caption:
    fontFamily: "Onest Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  small:
    fontFamily: "Onest Variable, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  lead:
    fontFamily: "Onest Variable, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
  lead-wide:
    fontFamily: "Onest Variable, system-ui, sans-serif"
    fontSize: "19px"
    fontWeight: 400
  micro:
    fontFamily: "Onest Variable, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
  stage:
    fontFamily: "Onest Variable, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  name-sm:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "18px"
    fontWeight: 400
  name-md:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "18.4px"
    fontWeight: 400
  item-title:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "1.2rem"
    fontWeight: 400
    lineHeight: 1.2
  price:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.2
  section-sm:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "20.8px"
    fontWeight: 400
  row-when:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "22px"
    fontWeight: 400
  group-title:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "22.4px"
    fontWeight: 400
  panel-title:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.15
  head-title:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "26px"
    fontWeight: 400
  total:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 400
    lineHeight: 1.1
  detail-title:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "28.8px"
    fontWeight: 400
  page-title-sm:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "30px"
    fontWeight: 400
  page-title:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "30.4px"
    fontWeight: 400
  headline-lg:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "36px"
    fontWeight: 400
  headline-xl:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "36.8px"
    fontWeight: 400
  display-sm:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "40px"
    fontWeight: 400
  hero-wide:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "clamp(3.5rem, 6vw, 4.5rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "-0.03em"
  checkout-title:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "clamp(2rem, 8vw, 2.75rem)"
    fontWeight: 400
    lineHeight: 1.05
  done-title:
    fontFamily: "Gloock, Georgia, serif"
    fontSize: "clamp(2.2rem, 9vw, 3rem)"
    fontWeight: 400
    lineHeight: 1.05
rounded:
  sm: "10px"
  control: "12px"
  md: "16px"
  lg: "20px"
  plate: "14px"
  input: "4px"
  legacy-control: "6px"
  bar: "8px"
  pill: "999px"
  circle: "50%"
spacing:
  gutter: "16px"
  gutter-wide: "24px"
  page-desktop: "36px"
  section: "40px"
  hero: "56px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 22px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
    textColor: "{colors.paper}"
  button-primary-disabled:
    backgroundColor: "{colors.primary-disabled-bg}"
    textColor: "{colors.primary-disabled-text}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 18px"
  button-leaf:
    backgroundColor: "{colors.leaf}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "44px"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger-ink}"
    rounded: "{rounded.pill}"
    height: "44px"
  button-disabled:
    backgroundColor: "{colors.disabled-bg}"
    textColor: "{colors.disabled-text}"
  button-on-dark:
    backgroundColor: "{colors.gold-on-dark}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "48px"
    padding: "0 18px"
  button-add:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "44px"
    padding: "0 18px 0 14px"
  stepper:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    height: "44px"
  box-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    padding: "10px 16px"
  stage-pending:
    backgroundColor: "{colors.amber-tint}"
    textColor: "{colors.amber}"
    rounded: "{rounded.pill}"
  stage-confirmed:
    backgroundColor: "{colors.gold-tint}"
    textColor: "{colors.gold-deep}"
    rounded: "{rounded.pill}"
  stage-preparing:
    backgroundColor: "{colors.purple-tint}"
    textColor: "{colors.purple-text}"
    rounded: "{rounded.pill}"
  stage-ready:
    backgroundColor: "{colors.leaf-tint}"
    textColor: "{colors.leaf}"
    rounded: "{rounded.pill}"
  stage-cancelled:
    backgroundColor: "{colors.danger-tint}"
    textColor: "{colors.danger-ink}"
    rounded: "{rounded.pill}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  card-photo:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  order-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  comanda:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "44px"
---

# Identidade e interface Saint Cakes

## Overview

Autoridade: logo e artes do Instagram fornecidas pelo usuário em 22/10/2026. Preserve a marca existente. `public/brand/saint-cakes.png` é cópia da imagem fornecida, sem alteração; não é arquivo vetorial oficial.

O app da equipe e a página pública `/pedido` usam o mesmo mundo: chocolate, creme, dourado, verde folha e terracota, com Gloock para títulos, nomes e valores, e Onest para o restante. Os tokens são compartilhados (`src/theme.css`, prefixo `--sc-*`; na página pública, `.po`). Regras sem marcação valem para as duas superfícies; regras marcadas valem só para a indicada.

**Tese da página pública:** pedir é encher uma caixa Saint Cakes. A caixa fica sempre visível, enche conforme o cliente escolhe e é o caminho para fechar o pedido. A foto do produto é o ornamento; a página não tem decoração além disso.

**App da equipe:** a semana da loja como uma lista viva, agrupada em Atrasadas, Hoje, Amanhã, Esta semana, Mais adiante e Anteriores, com o pedido selecionado aberto ao lado. Status é sempre pílula com ponto e texto, nunca só cor. O painel e a produção usam as mesmas peças.

**Key Characteristics:**
- Chocolate como trilho e barra; creme como papel; dourado para seleção, foco e valores.
- Caixa sempre visível na página pública: faixa no celular, coluna no desktop.
- Lista agrupada com detalhe ao lado no desktop e em tela cheia no celular.
- Fotos reais de produtos em quadros de 20px; sem foto certa, linha de cardápio.
- Controles e status em pílula; números tabulares.
- Sem sombra dura; profundidade por anel interno de 1px e, no app, por sombra suave única.
- Gloock e Onest self-hosted (`@fontsource`), sem host externo de fonte.

## Colors

Creme como papel, chocolate como texto e ação principal, dourado como acento. A cor do status acompanha sempre um texto e um ponto.

### Primary
- **Chocolate** (#392317, `ink`): texto, trilho, faixa de cabeçalho, caixa, botão principal e fundo do stepper. Hover em `ink-hover` (#4f3322).
- **Dourado** (#936326, `gold`): foco visível (contorno de 3px, deslocamento de 3px), campo em foco, seleção e valores em destaque. Links e dicas usam `gold-deep` (#74501e), por contraste sobre o creme.

### Secondary
- **Verde folha** (#2f5440, `leaf`): o que está feito, pago ou confirmado. Na página pública marca item escolhido (anel de 2px no card; `leaf-tint` #e6efe7 na linha) e o sinal de 50%. No app: status Pronto e Entregue, pagamento quitado e os botões de WhatsApp (`button-leaf`).
- **Terracota** (#9c493b, `danger`; texto `danger-ink` #7d3426; fundo `danger-tint` #f7e8e3): cancelado, atrasado e alertas. O título do grupo Atrasadas usa `danger-ink`.

### Tertiary
- **Âmbar** (texto #7a5414, `amber`; fundo `amber-tint` #f6ead2): A confirmar e sinal pendente.
- **Roxo** (texto #5b3f72, `purple-text`; fundo `purple-tint` #ece4f2): Em produção. Usado também como faixa de cabeçalho da comanda.
- **Dourado claro** (`gold-tint` #f3e8d2): Confirmado, seleção de escolha, notas. Sobre chocolate: `gold-on-dark` #f0d9a8 (botão claro na faixa e na caixa), `gold-on-dark-hover` #f7e6c2, texto `on-dark-muted` #e6d9c3.

### Neutral
- **Creme** (#faf7f0, `paper`): papel de base.
- **Superfície** (#fffdf9, `surface`) e campo branco (#fff, `white`): cards, painéis, linhas e campos.
- **Rebaixado** (#f3ede2, `sunk`): áreas de resumo e chips neutros.
- **Linha** (#e5dccd, `line`) e **linha forte** (#d6c8b3, `line-strong`): divisores, bordas de campo e de chip.
- **Texto secundário** (#6b5c4c, `muted`).
- **Desativado:** fundo `disabled-bg` #e9e1d4 com texto `disabled-text` #8a7c6b; na página pública, `primary-disabled-bg` #d9cfbf com `primary-disabled-text` #5f5242 e `on-dark-disabled` #d9cdb8.
- **Seleção e rolagem:** `selection` #ecd9b4, `scrollbar` #cdbfa8. Gráfico do painel: `bar-fill` #d9bf8c.
- **Legado e impressão:** `legacy-account` #f1eade (faixa de conta do CSS antigo, `shared.css`); `print-ink`, `print-black`, `print-rule`, `print-hairline` só na ficha impressa.

### Named Rules
**The Leaf Is Done Rule.** O verde folha marca o que está feito, pago ou confirmado. Ação comum é chocolate. No app, os botões de WhatsApp são as únicas ações em verde folha, pois entregam a confirmação ao cliente.

**The Stage Pill Rule.** Cada etapa tem uma cor de pílula e um texto: A confirmar âmbar, Confirmado dourado, Em produção roxo, Pronto e Entregue verde folha, Cancelado terracota. A cor nunca aparece sem o texto.

## Typography

**Display Font:** Gloock (com Georgia, serif). Títulos, nomes de cliente e de produto, preços e totais. Self-hosted por `@fontsource/gloock` (peso 400).
**Body Font:** Onest Variable (com system-ui, sans-serif). Controles, rótulos, datas e texto corrido. Self-hosted por `@fontsource-variable/onest`. Não há importação de host externo de fontes.

**Character:** Gloock dá o tom de confeitaria aos nomes e aos valores; Onest mantém controles e dados legíveis. Números usam algarismos tabulares (`.sc-num`, `.sc-money`) para que colunas de horário e de valor se alinhem.

### Hierarchy
- **Display** (400, `clamp(2.6rem, 12vw, 3.2rem)` no celular e `clamp(3.5rem, 6vw, 4.5rem)` no desktop, lh 1, -0.03em): título da página pública ("Monte sua caixa").
- **Headline** (400, 2rem, lh 1.1, -0.02em): títulos de seção ("Bolos", "Mini salgados", "Sob medida").
- **Título de página do app** (400, `clamp(1.9rem, 6vw, 2.6rem)`, lh 1.05): Encomendas, Produção, Clientes, Loja. Painel: `clamp(1.875rem, 3vw, 2.5rem)`.
- **Título de detalhe** (400, `clamp(1.8rem, 6vw, 2.3rem)`, lh 1.05): nome do cliente no detalhe do pedido.
- **Title** (400, 1.35rem em card; 1.2rem em linha do cardápio e nome de linha de encomenda): nomes de produto e de cliente nas listas.
- **Price and money** (Gloock, 1.25rem nos preços; 1.5rem nos valores do detalhe; 1.75rem no total estimado): sempre tabular.
- **Grupo** (400, 1.4rem / 22.4px, com contagem em Onest 13px): cabeçalhos de Atrasadas, Hoje e demais grupos.
- **Hora da comanda** (400, 2rem, lh 1): horário grande no cabeçalho do ticket.
- **Body** (400, 16px, lh 1.5; parágrafos 1.55): texto corrido; descrições em 14px no tom `muted`.
- **Label** (600, 0.9375rem, lh 1): botões, abas e rótulos de campo em destaque.
- **Caption e stage** (600, 12px, Onest): pílulas de status e de pagamento; 13px para metadados e legendas de campo.
- **Micro** (600, 11px): rótulos de aba do celular e de trilho.

### Named Rules
**The Tabular Figure Rule.** Preços, quantidades, horários, totais e saldos usam algarismos tabulares, para que as colunas se alinhem na caixa, na lista e na comanda.

## Layout

**Página pública `/pedido`:** largura máxima de 1240px, gutter de 16px no celular e 24px a partir de 700px. Seções com padding superior de 40px e separador de 1px. Abas fixas no topo (`sticky`, top 0).
- Abaixo de 560px: campos em uma coluna. A partir de 560px: data e horário, e nome e WhatsApp, em duas colunas.
- 700px: cards com foto em duas colunas; linhas do cardápio com preço e controle na mesma linha.
- 960px: hero em duas colunas (1.1fr / 0.9fr, gap 56px); checkout em `1fr 360px`, com total fixo à direita; a barra de total do celular some.
- 1000px: catálogo e caixa em `minmax(0, 1fr) 340px`, gap 40px; a caixa vira coluna sticky (top 72px).
- Celular: a caixa é barra fixa no rodapé, com `env(safe-area-inset-bottom)`. No checkout, a barra de total e o botão de envio ficam fixos até 960px.

**App da equipe:** em telas de celular (abaixo de 700px), barra superior de 56px em chocolate com logo de 36px e nome da página em Gloock 20px, e barra inferior fixa de abas: Painel, Encomendas, Produção, Site (quando a conta vê pedidos do site) e Mais. As abas têm 52px de altura e a barra soma `64px + safe-area`.
- 700 a 999px: trilho chocolate de 104px, rótulos curtos (`.sc-label-short`) em 12px. Conteúdo com padding de 28px e rodapé de 48px.
- 1000px ou mais: trilho de 232px com logo, rótulos, contagem e conta da equipe. Conteúdo com padding de 32px por 36px.
- Encomendas: lista e detalhe. Abaixo de 1000px, o detalhe ocupa a tela inteira, com barra de voltar. A partir de 1000px, o detalhe é painel lateral sticky (top 24px, altura máxima `100dvh - 48px`, rolagem própria), com 360 a 420px; a partir de 1280px, 440px.
- Conteúdo máximo de 1440px. Painel e Clientes: máximo de 1240px. Formulário: máximo de 1240px, com barra de salvar fixa acima das abas no celular.
- Breakpoints usados: página pública 560, 700, 960, 1000 e 1240 (largura máxima); app da equipe 420, 600, 640, 700, 1000 e 1280.

**Dados de leitura:** a lista agrupa por Atrasadas, Hoje, Amanhã, Esta semana, Mais adiante e Anteriores. Cada grupo é ordenado por data e horário. Anteriores fica recolhido por padrão.

## Elevation & Depth

Página pública: plana em repouso. Bordas são anéis internos de 1px (`inset 0 0 0 1px` na cor `line`). Sombra aparece só como resposta a estado ou em barra fixa.

App da equipe: cards com borda de 1px em `line`; a sombra suave `--sc-shadow` (0 1px 2px e 0 8px 24px, ambas em chocolate a 6%) aparece no pedido selecionado, no painel de detalhe, na comanda e nos cards de login. 

### Shadow Vocabulary
- **Barra fixa** (`0 -6px 24px rgba(57,35,23,.18)`): caixa no celular da página pública.
- **Barra de checkout** (`0 -8px 24px rgba(57,35,23,.18)`): total fixo no celular da página pública.
- **Seleção** (`0 6px 20px rgba(57,35,23,.08)`): card escolhido na página pública, junto ao anel `leaf`.
- **Caixa sticky** (`0 8px 28px rgba(57,35,23,.07)`): coluna da caixa no desktop da página pública.
- **Superfície do app** (`--sc-shadow`, `0 1px 2px rgba(57,35,23,.06), 0 8px 24px rgba(57,35,23,.06)`): detalhe, comanda, linha selecionada.
- **Barra de abas** (`0 -8px 24px rgba(57,35,23,.16)`): barra inferior do celular no app.

### Named Rules
**The Hairline Rule.** Na página pública, a borda é um anel interno de 1px. Sombra só responde a estado ou fixa uma barra.

## Shapes

Raios por papel, sem misturar:
- **10px** (`sm`): campos, alertas, avisos e notas do app.
- **12px** (`control`): campos da página pública, dicas, erros, abas e itens do menu de navegação.
- **14px** (`plate`): resumo de sinal e botões do trilho.
- **16px** (`md`): linhas de encomenda, cards de escolha, painéis do app, comandas.
- **20px** (`lg`): quadros de foto, cards da página pública, painéis de checkout, caixa desktop, detalhe do app, login.
- **Pílula** (999px): botões de ação, abas, stepper, filtros, pílulas de status e de pagamento, busca.
- **Círculo** (50%): miniaturas, logo, marca de concluído, botões de ícone de 44px.
- Casos isolados, a registrar: 4px no campo numérico do stepper (página pública); 8px no topo das barras do gráfico; 6px em botões da folha antiga (`shared.css`).

## Components

### Caixa (página pública)
- **Celular (faixa fixa):** fundo chocolate, texto creme, padding 10px 16px. Mostra só as duas últimas miniaturas da sequência (ordem do catálogo, não ordem de escolha; a miniatura de item sob medida vem por último), contagem, total com "+ orçamento" quando houver item sob consulta, e o botão "Fechar pedido" em `button-on-dark`.
- **Desktop (coluna sticky):** fundo `surface` com anel interno, lista das linhas escolhidas (altura máxima 240px com rolagem), sinal de 50% em faixa `leaf-tint`, botão "Fechar pedido" em chocolate.

### Cards com foto (página pública)
- Só para produtos com foto certa do catálogo da loja. Hoje são seis: Bolo Sonho de valsa, Bolo Prestígio, Mini hambúrguer, Mini sanduíche de patê, Mini pizza e Mini folhado.
- Foto em 4:3, `object-fit: cover`, quadro de 20px no topo. Título em Gloock, detalhe em `muted`, preço e controle na mesma linha.
- Card escolhido ganha anel `leaf` de 2px.

### Linhas do cardápio (página pública)
- Demais produtos são linhas com divisor de 1px: nome e descrição à esquerda, preço e controle à direita. Linha escolhida ganha fundo `leaf-tint`.
- Produto sem foto própria usa a miniatura da marca (`public/brand/saint-cakes.png`), nunca imagem de terceiros ou gerada.

### Stepper (página pública)
- Pílula chocolate com texto creme, altura 44px. Botões "−" e "+" circulares de 40px, dentro da pílula de 44px (desvio do alvo de 44px, não canonizado); o campo central tem 3.5ch e é editável.
- Bolos (por quilo): passo 0,5 kg; o primeiro toque em "Adicionar" põe 1 kg.
- Salgados (por unidade): passo de 10; o primeiro toque põe 10.
- Aceita digitação com vírgula ou ponto, até 1000; em unidades arredonda para inteiro; em quilo, para milésimo.
- Ao chegar a zero, o item volta a "Adicionar".

### Botões
- **Primário** (`button-primary`): pílula chocolate, texto creme, 48px na página pública e 44px mínimo no app; hover `ink-hover`.
- **Secundário** (`button-secondary`): superfície com borda `line-strong`; hover com borda chocolate.
- **Folha** (`button-leaf`): só para o WhatsApp e confirmações ao cliente.
- **Perigo** (`button-danger`): texto `danger-ink`, borda `danger-border`, fundo transparente.
- **Quieto:** texto dourado escuro, sem fundo; hover `gold-tint`.
- **Desativado** (`button-disabled`): `disabled-bg` com `disabled-text`. Sem opacidade.
- **Adicionar** (`button-add`): pílula transparente com anel interno chocolate de 1,5px; hover preenche com chocolate.
- **Sobre faixa escura** (`button-on-dark`): `gold-on-dark` com texto chocolate.

### Pílulas de status e pagamento (app)
- Status: `stage-pending`, `stage-confirmed`, `stage-preparing`, `stage-ready` (Pronto e Entregue), `stage-cancelled`. Pílula de 24px com ponto de 7px na cor do texto.
- Pagamento: `Pago` e `Sinal anotado` em verde folha; `Sinal pendente` em âmbar; `Cancelada` em cinza rebaixado.

### Encomenda na lista (app)
- `order-row`: coluna de horário em Gloock 22px, nome em Gloock 1.2rem, até duas linhas de itens em 14px, e pílulas de status e pagamento. O pedido selecionado ganha borda chocolate de 1px.

### Comanda (produção)
- Cartão de 16px com cabeçalho na cor da etapa (`--tint`): horário grande em Gloock 2rem, número do pedido, nome em 22px, metadados em 13px.
- Itens em 17px com divisor tracejado; observações em `gold-tint`.
- Ação em largura total, 52px de altura, pílula.
- Grade de comandas de no mínimo 280px por coluna. A produção vê quantidades e observações, nunca valores.

### Formulários e alertas (app)
- Campo: rótulo de 13px em 600; entrada de 44px, borda `line-strong`, raio 10px, fundo branco; foco com contorno dourado de 3px.
- Alerta (`sc-alert`): fundo `danger-tint`, texto `danger-ink`, com ação de fechar quando couber. Aviso (`sc-notice`): fundo `leaf-tint`, texto `leaf`.

### Logo e miniaturas
- Logo em círculo: 56px na faixa da página pública, 36px no topo do app e no cabeçalho da conta. O arquivo não é alterado; a forma circular é só recorte de exibição.
- Miniaturas da caixa: 36px, círculo, anel de 2px na cor da faixa.

### Movimento
- Página pública: única animação autoral é a entrada da miniatura recém-adicionada na caixa com `po-pop`, 0,42s, curva `cubic-bezier(.16, 1, .3, 1)` (ease-out exponencial), de opacidade 0, 8px abaixo e escala 0,4 até o estado final. Transições de cor e sombra usam `cubic-bezier(.2, .8, .2, 1)` entre 0,2s e 0,25s. Botões primário e Adicionar encolhem para 97% ao toque.
- App da equipe: sem animação de palco. Transições de cor e borda em 0,15s (linhas, botões, alternância) e a bolinha da alternância.
- Com `prefers-reduced-motion: reduce`, todas as transições e animações são desligadas nas duas superfícies.

### Atualização e ações (app)
- Atualização em segundo plano nunca desabilita ações. O rótulo da conta mostra "Atualizando…" enquanto lê, e os botões seguem ativos.
- O estado ocupado (`busy`) bloqueia ações só durante uma gravação (salvar, mudar andamento e demais escritas). O botão Atualizar fica desabilitado enquanto sincroniza, por ser o próprio controle de leitura.

## Do's and Don'ts

### Do:
- **Do** manter o chocolate como ação principal e a caixa como única fonte do total exibido na página pública.
- **Do** mostrar status sempre como pílula com ponto e texto; a cor sozinha não basta.
- **Do** manter alvos de no mínimo 44px para controles, abas, links e botões de ícone.
- **Do** manter foco visível: 3px dourado com deslocamento de 3px.
- **Do** usar algarismos tabulares em preços, quantidades, horários e totais.
- **Do** deixar a gravação em curso ocupar as ações até concluir, e só ela; a leitura em segundo plano não entra nisso.
- **Do** manter o resumo de produção sem valores para quem não tem acesso financeiro.

### Don't:
- **Don't** usar verde folha como botão de ação comum; ele marca o feito, o pago e o confirmado.
- **Don't** usar o verde folha como cor de alerta ou de cancelamento.
- **Don't** carregar fontes de host externo; Gloock e Onest vêm pelo pacote do build.
- **Don't** usar Georgia ou Arial como fonte de títulos ou de corpo do app; são fallbacks.
- **Don't** usar foto sem procedência certa em card; sem foto, a linha do cardápio e a miniatura da marca.
- **Don't** criar animação decorativa nova. A única animação autoral é a entrada da miniatura na caixa.
- **Don't** usar sombra de deslocamento duro.
- **Don't** bloquear ações pela atualização em segundo plano.

## Personalização por loja (incremento local)

A identidade Saint Cakes descrita acima continua sendo o padrão exclusivo da sua loja. Outras empresas configuram nome, apresentação, WhatsApp, logo/capa por HTTPS e catálogo próprios em Loja. Não preencher imagens ausentes com a marca ou fotos da Saint Cakes. O catálogo vazio mostra caminho para pedir orçamento.

As paletas chocolate, verde floresta e ameixa alteram tokens sem criar outro sistema de componentes. O editor reutiliza cards, campos e botões existentes, com feedback de gravação e rascunho mantido em conflito/falha de atualização. Paletas livres, fontes próprias, upload de imagem e manifesto instalável por marca ficam fora deste incremento.
