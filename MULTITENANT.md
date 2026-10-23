# Plataforma multiclientes para confeitarias e padarias

Decisões confirmadas pelo usuário em 23/10/2026: atender **confeitarias e padarias**, com **uma loja por conta por enquanto**. A Saint Cakes passa a ser a primeira empresa da plataforma (`saint-cakes`), preservando sua identidade e seus dados. Nome/marca da plataforma, mensalidade, duração de teste e meio de cobrança ainda não foram definidos nesta decisão.

Arquitetura inicial: **uma aplicação e um banco compartilhados**, com separação obrigatória por loja. Uma instalação por cliente não será o padrão desta fundação; limites de capacidade precisam ser medidos antes de ampliar a operação.

Estado: a fundação feita no Claude (`f88ce1f`) foi recuperada e revisada na branch `codex/multiclientes-foundation`, worktree `C:\Users\fferr\.codex\worktrees\saintcakes-platform`. Fundação e personalização por loja aplicadas **somente ao banco local**, até a migração `20261026140000`. Nenhum deploy ou banco remoto foi alterado nesta evolução. A fase 2 foi validada com lojas e contas fictícias; publicação, provisionamento administrativo com interface e operação comercial ainda estão pendentes.

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
2. Aplicar as migrações no remoto com autorização específica, em uma transação controlada. **Antes de executar o primeiro comando da migração da fundação**, bloquear `private.staff_members`, depois `private.shop_settings` e então `private.order_records` em `ACCESS EXCLUSIVE MODE`, na mesma transação. O bloqueio intermediário de configurações drena envios anônimos que podem consultar pedidos para conferir cupons; evita ciclo de locks com uma gravação em andamento. Essa sequência também precede a leitura de `max(number)` que inicializa o contador. Usar timeout curto de lock e interromper se houver escrita ativa, em vez de manter a operação bloqueada indefinidamente. Não reescrever a migração já aplicada localmente. `node scripts/prepare-platform-release.mjs` gera SQL revisável em `verification/platform-release.sql`, com histórico esperado, verificações de preservação dos registros e rollback integral em falha; não executa nada. O pacote foi ensaiado em banco descartável com as sete migrações anteriores, sem concorrência nem dados de produção.
3. Publicar o front na Vercel logo em seguida. Enquanto isso, o site antigo segue funcionando pelas funções de transição.
4. Conferir: login da Saint Cakes, número do próximo pedido (continua a sequência), `/pedido` e `/pedido/saint-cakes`, envio de pedido do site, upload de foto na vitrine.

`20261026130000_guard_tenant_photos.sql` acrescenta validação do caminho da foto também na referência salva no item. Uma loja não pode vincular o arquivo de outra, mesmo sendo uma imagem pública. Caminhos legados `showcase/arquivo` continuam aceitos somente na Saint Cakes; novos caminhos usam `<tenant_id>/showcase/arquivo.jpg|png|webp`, sem subpastas ou travessia de diretórios.

Links de loja inexistente, pausada ou malformada não exibem o catálogo da Saint Cakes como alternativa. Falha de conexão impede abrir o catálogo até nova tentativa; a loja precisa ser confirmada no servidor.

## Fase 2 — cada loja com a própria cara

Implementada localmente na migração `20261026140000_tenant_storefronts.sql`. `private.storefronts` mantém identidade, catálogo e revisão por empresa, com RLS fechado e acesso por RPC. `read_storefront` deriva a empresa da membership; `save_storefront` exige dono e revisão esperada; `public_storefront(p_shop)` mostra somente lojas ativas ou em teste. Logo e capa usam URLs HTTPS opcionais; os arquivos locais da Saint Cakes são exclusivos dela. Há três paletas: chocolate, verde floresta e ameixa.

O dono edita identidade e até 100 produtos na área **Loja**. Produtos têm categoria, nome, unidade, preço em centavos, detalhes e foto opcional. A Saint Cakes recebe os 26 itens já transcritos; empresas novas começam com catálogo vazio e sem seus contatos ou imagens. A demonstração local continua separada e usa o catálogo original.

Página pública, catálogo do formulário interno, cabeçalhos, título, mensagens de confirmação, comprovantes, comandas, notificações e nome do CSV usam a empresa correspondente. Preferências e histórico de impressão ficam separados por loja e aparelho; a Saint Cakes preserva as chaves antigas, e a demonstração usa outro espaço. O aplicativo instalável tem nome/ícone genéricos; manifesto próprio para cada marca e upload de imagens pelo editor não foram implementados.

No envio público, linhas de catálogo levam `catalogItemId` e o pedido leva `storefrontRevision`. O banco busca descrição, unidade e preço no catálogo daquela empresa, ignorando as cópias enviadas pelo navegador. IDs desconhecidos ou de outra loja são recusados; mudança de revisão exige conferir o catálogo atualizado. Itens sob orçamento continuam sem preço e pronta entrega continua precificada pelo estoque. Por compatibilidade temporária, somente a Saint Cakes aceita o contrato antigo de preços estimados quando não há revisão; isso ainda exige revisão da equipe antes de virar encomenda. Remover esse caminho e as funções públicas antigas somente depois da atualização do site em produção.

Os dois cadastros fictícios usados no navegador exibiram apenas seus próprios produtos e preços. O teste incluiu envio/conversão de pedido, troca de login, produção sem valores, nome nos comprovantes e WhatsApp, rascunho preservado em conflito/falha de atualização, celular sem rolagem horizontal e compatibilidade da Saint Cakes. As fixtures temporárias são removidas ao concluir a verificação.

## Fase 3 — painel do administrador

Tela para o administrador da plataforma criar loja, provisionar o responsável, pausar/reativar e ver lojas ativas. Acesso de administrador da plataforma é distinto de dono de loja; não concede consulta irrestrita ao financeiro dos clientes por inferência. Cadastro autônomo e período gratuito dependem de decisão posterior. Se uma pessoa precisar trabalhar em mais de uma loja, revisar a chave de `staff_members` e a seleção da loja ativa; essa opção ficou fora da primeira versão por decisão do usuário.

## Fase 4 — cobrança e jurídico

Modelo comercial e eventual recorrência dependem de definição. Depois dessa escolha, avaliar gateway, tratamento de atraso, termos de uso, política de privacidade e responsabilidades no tratamento de dados. Não reutilizar a anotação de pagamento de encomendas como cobrança da assinatura da plataforma.

## Custos

Conferir capacidade, backups, condições comerciais dos provedores e preços atuais antes de contratar ou definir preço por loja. Nenhuma contratação foi feita; compartilhar infraestrutura não garante capacidade ilimitada nem economia já medida.

## Evidência da revisão local

59 testes Node e 489 testes pgTAP passaram. Incluem os 114 testes de isolamento da fundação, 24 de referência de fotos e 116 novos de personalização/catálogo. Typecheck, lint, build e advisors locais passaram. CAS de encomenda passou pelo script existente com duas conexões; uma verificação adicional do catálogo com duas conexões reais observou o lock e recusou a revisão obsoleta. A sequência de lock antes da migração da fundação foi revisada estaticamente; não foi executado um ensaio dessa migração com gravações concorrentes. Build mantém aviso de tamanho do bundle. Capturas e resumo da verificação ficam em `verification/` (ignorado pelo Git). Nenhum teste criou pedidos reais em produção nem enviou mensagens a clientes; a impressão foi conferida no DOM com a janela de impressão substituída por função vazia, sem impressora física.
