# Saint Cakes · Encomendas

Aplicação em validação local, iniciada em 22/10/2026. React/TypeScript/Vite com demonstração no navegador e modo compartilhado Supabase. Git independente, origem `https://github.com/jonathanfferreira/saintcakes`. Publicação na Vercel autorizada em22/10/2026; configuração compartilhada usa projeto Supabase exclusivo. Contratação e operação real não confirmadas.

## Executar a demonstração

Node.js 24+ e npm, dependências fixadas no package-lock.json. Sem valores Supabase em `.env.local`/ambiente:

```powershell
npm ci
npm run dev
```

Abrir http://127.0.0.1:3022. Porta fixa para preservar a origem dos dados locais. `npm run build` gera dist/; `npm run preview` serve o build na mesma porta, após encerrar o servidor dev. A demonstração não compartilha dados entre aparelhos e não faz upload ao banco.

## O que funciona

- Cadastro/edição de encomenda com cliente, data, horário, retirada/entrega, endereço, observações e itens por unidade/kg/cento.
- 26 opções iniciais conferidas no PDF fornecido, páginas 3 e 17; catálogo parcial, preços editáveis.
- Total, sinal previsto de 50% e saldo em centavos; recebido anotado manualmente e independente do andamento.
- Agenda diária, histórico, busca e filtro por etapa; resumo de produção, ficha de impressão.
- Demonstração: persistência local e exportação/restauração JSON validada, com proteção contra importação concorrente. Limite local de 2.000 pedidos; limpar o navegador pode apagar esses dados.
- Compartilhado: login, pedidos em banco, controle de revisão contra sobrescrita, trilha de alterações de pedidos e exportação pelo dono. Importação de backups para o banco não está implementada.
- Equipe: dono define função, acesso financeiro e ativação por pessoa. Produção com financeiro consulta valores sem editar pagamentos. Sem financeiro, a API entrega apenas dados operacionais. Contas precisam estar provisionadas previamente.

## Ambiente compartilhado local

Não é banco publicado. Requer Supabase CLI e Docker. Projeto isolado `saintcakes`, API54351, Postgres54352, e-mail de teste54354; faixa54350–54359 reservada. Não usar portas nem containers dos outros projetos.

```powershell
docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 saintcakes-local
supabase start --network-id saintcakes-local --exclude realtime,storage-api,imgproxy,studio,edge-runtime,logflare,vector,supavisor,postgres-meta
```

Crie a rede somente se ainda não existir. O comando start aplica as migrações locais. Em Windows/Docker Desktop, conferir os bindings efetivos: a opção de rede não garante sozinha que as portas publicadas usem apenas loopback. A rede não deve ser considerada um controle de autorização. Usar apenas fixtures locais enquanto o ambiente de operação não for preparado.

Para configurar o cliente, capture o status em memória, sem copiar chaves privilegiadas ao frontend:

```powershell
$saintLocal = supabase status -o json | ConvertFrom-Json
Set-Content .env.local "VITE_SUPABASE_URL=$($saintLocal.API_URL)`nVITE_SUPABASE_PUBLISHABLE_KEY=$($saintLocal.PUBLISHABLE_KEY)"
Remove-Variable saintLocal
npm run dev
```

`.env.example` descreve as duas variáveis públicas. Configuração parcial/inválida exibe erro; não volta silenciosamente para dados locais. `VITE_` fica público no bundle: nunca colocar senha, connection string, JWT service_role ou `sb_secret_` ali.

No `config.toml`, `auth.enable_signup=false` bloqueia cadastro público. `auth.email.enable_signup=true` mantém o provedor de login por e-mail habilitado nesta CLI; ambos falsos também desabilitam login. Isso foi conferido por teste real de signup recusado e login aceito.

Provisionamento de identidades Auth e do primeiro dono é administrativo, sem seed de senhas nem envio de convites por este app. Cada identidade precisa de membership em `private.staff_members`. Dono exige `role='owner', active=true, can_view_financial=true`. Depois, a tela Equipe administra as memberships existentes. Fronteiras, RPCs, privilégios e testes: [supabase/SECURITY.md](supabase/SECURITY.md).

Leituras atualizam a cada 10 segundos enquanto a aba estiver visível, além do botão Atualizar. O banco confere a permissão em cada chamada; mudanças não dependem de renovar JWT. Dados já vistos não podem ser recolhidos do aparelho, impressos ou backups do usuário. Não há garantia de atualização instantânea nem gravação offline. Conflito mantém rascunho; conferir versão atual antes de refazer a edição.

Para encerrar apenas esta pilha e preservar volumes: `supabase stop --project-id saintcakes`. Não usar `--all` nem `--no-backup`. Não executar os testes locais em banco remoto.

## Verificações

```powershell
npm test
npm run typecheck
npm run lint
npm run build
supabase test db --local --network-id saintcakes-local supabase/tests/shared_orders.test.sql
& ./supabase/tests/concurrent_revision.ps1
supabase db advisors --local --type security --level warn --fail-on error
```

Se o filtro RTK falhar ao interpretar o lint: `rtk proxy npm run lint`. Evidências reais e limitações: [VALIDATION.md](VALIDATION.md).

## Limites e próximos incrementos

Não há WhatsApp conectado, confirmação bancária, cobrança, emissão fiscal, cálculo automático de frete, kits, topper ou descontos. Catálogo/regras em [CATALOG.md](CATALOG.md), produto em [PRODUCT.md](PRODUCT.md), identidade em [DESIGN.md](DESIGN.md). Observações/descrições são compartilhadas com a produção: não anotar nelas finanças sigilosas.

Antes de operar: preparar ambiente publicado e contas reais, provisionamento/recuperação de acesso, backup e restauração do banco; validar catálogo completo, personalizações e políticas comerciais; conferir segurança do ambiente e aparelhos. Auditoria atual é de pedidos, não de mudanças de permissão. Backend atual é para uma única confeitaria; desempenho em volume e dispositivos físicos não medido. Nenhum recurso remoto foi criado ou alterado.

## Modelos e delegação

Coordenador integra e verifica. No primeiro incremento, Luna cuidou do domínio e da leitura do catálogo; Sol6.1 do formulário/revisão. No segundo, Sol6.1 alto cuidou do banco/permissões e Sol6.1 médio da autenticação/cliente; o risco de autorização justificou a escolha. Não foram contratadas APIs externas. Isso não mede economia comparativa; consumo por trabalhador não foi disponibilizado. Política: `../../../CONTEXT/AI-MODEL-ROUTING.md`.

## Publicação na Vercel

Projeto `ecapx/saintcakes`, Vite/Node24, build `npm run build`, saída `dist`. `vercel.json` mantém deep links e noindex. As duas variáveis VITE_SUPABASE ficam no painel Vercel, nunca em arquivos versionados. Builds Vercel exigem URLHTTPS e chave publishable para impedir publicação acidental do modo de demonstração. A configuração local em `.env.local` é independente.

Destino Supabase informado pelo usuário: `uzesslqldbuplovidgkq`, em conta própria e separada do XTAGE. A aplicação do schema e o fechamento do cadastro público exigem acesso administrativo a esse projeto. A chave publishable identifica o cliente, mas não autoriza migração ou configuração de Auth. Contas reais e o primeiro administrador precisam ser provisionados antes do uso pela equipe.
