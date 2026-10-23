# Multiclientes (várias confeitarias no mesmo sistema)

Objetivo: vender o sistema como mensalidade para outras confeitarias usando **um banco e um deploy**, em vez de um projeto por cliente. A Saint Cakes é a loja nº 1 (`saint-cakes`).

## Fase 1 — fundação no banco (migração `20261026120000_multitenant_foundation.sql`)

- `private.tenants`: loja com `slug` (endereço do link), nome, situação (`trial`, `active`, `paused`) e contador de pedidos.
- `tenant_id` obrigatório em `staff_members`, `order_records`, `order_requests`, `customers`, `coupons`, `showcase_items` e `shop_settings`. Os dados existentes foram atribuídos à Saint Cakes (`a0000000-0000-4000-8000-000000000001`).
- **Uma loja por conta**: `staff_members.user_id` continua chave primária. Todas as RPCs da equipe obtêm a loja pela membership ativa de quem chama; nenhuma aceita loja vinda do navegador.
- Unicidade por loja: número do pedido (cada loja começa no #001; a Saint Cakes continua do último número), código de cupom e telefone de cliente.
- Páginas públicas recebem o slug: `public_settings(p_shop)`, `public_showcase(p_shop)`, `check_coupon(p_shop, …)`, `submit_order_request(p_shop, …)`. Loja desconhecida ou pausada → `SHOP_NOT_FOUND`. Limites anti-abuso (20 envios/10 min, 5/dia por telefone, 300 pendentes) valem por loja.
- **Transição**: as versões sem loja continuam existindo e atendem a Saint Cakes, para o site publicado não quebrar durante o deploy. Remover numa migração posterior, depois que o novo front estiver no ar.
- Fotos da vitrine: novos uploads em `vitrine/<id da loja>/showcase/…`; a política de storage só deixa editores da própria loja gravar ali. Arquivos antigos (`showcase/…`) pertencem à Saint Cakes.
- Front: `/pedido/<slug>` abre a página da loja; `/pedido` continua sendo a Saint Cakes. `current_staff` devolve `shop` (id, slug, nome, situação).

### Criar uma loja (administrativo, sem tela ainda)

1. Criar a conta da dona no Supabase Auth (painel do projeto → Authentication → Add user). O cadastro público continua fechado.
2. No SQL Editor (papel administrativo), rodar:

```sql
select private.create_tenant('doceria-exemplo', 'Doceria Exemplo', '<uuid do usuário>', 'Nome da dona');
```

A loja nasce em `trial`, com configurações padrão e a dona como `owner`. Uma conta só pode pertencer a uma loja.

### Publicar com segurança

1. Backup do banco remoto.
2. Aplicar a migração no remoto (autorização explícita do Jonathan).
3. Publicar o front na Vercel logo em seguida. Enquanto isso, o site antigo segue funcionando pelas funções de transição.
4. Conferir: login da Saint Cakes, número do próximo pedido (continua a sequência), `/pedido` e `/pedido/saint-cakes`, envio de pedido do site, upload de foto na vitrine.

## Fase 2 — cada loja com a própria cara

Logo, cores, nome e textos por loja (hoje a marca Saint Cakes está no código), catálogo de produtos por loja (hoje fixo em `catalog`), título da página e mensagens de WhatsApp com o nome da loja, mensagem "loja não encontrada" no link. Remover as funções públicas de transição.

## Fase 3 — painel do administrador

Tela para o dono do produto criar loja, convidar a dona, pausar/reativar e ver lojas ativas. Depois, cadastro com 14 dias grátis. Se uma pessoa precisar trabalhar em mais de uma loja, trocar a chave de `staff_members` para (loja, usuário) e escolher a loja ativa no login.

## Fase 4 — cobrança e jurídico

Mensalidade recorrente com o gateway escolhido (decisão pendente), bloqueio suave por atraso (`paused`), termos de uso e política de privacidade (o produto passa a ser operador de dados dos clientes das confeitarias, LGPD).

## Custos

Um projeto Supabase Pro e um Vercel Pro atendem todas as lojas (o plano Hobby da Vercel não permite uso comercial). Conferir preços atuais antes de contratar; nenhuma contratação foi feita.
