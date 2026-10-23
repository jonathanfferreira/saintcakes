# Saint Cakes · Encomendas

Evolução em desenvolvimento: plataforma multiclientes para **confeitarias e padarias**, **uma loja por conta** inicialmente. Fundação e personalização de identidade/catálogo estão implementadas e testadas localmente. O dono configura nome, contato, imagens, paleta e produtos na área Loja; o pedido público usa preços conferidos pelo servidor. Migrações remotas executadas pelo usuário em 23/10/2026 e endpoints públicos conferidos; publicação autorizada em andamento. A administração da plataforma continua pendente. Veja [MULTITENANT.md](MULTITENANT.md).

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
- Agenda diária, histórico, busca e filtro por etapa; resumo de produção.
- Impressão térmica (bobina 80mm ou 58mm, pelo `window.print` do navegador, qualquer impressora com driver Windows): comanda da cozinha sem valores e comprovante do cliente com total, sinal, recebido, saldo e Pix. Não é documento fiscal. Em Produção, o painel "Impressora de comandas" liga por aparelho (`src/printing.ts`, localStorage) a impressão automática da comanda quando uma encomenda vira Confirmada; ao ligar, as já confirmadas são marcadas como impressas. Sem janela de impressão só com o Chrome aberto por atalho com `--kiosk-printing` e a térmica como padrão.
- Demonstração: persistência local e exportação/restauração JSON validada, com proteção contra importação concorrente. Limite local de 2.000 pedidos; limpar o navegador pode apagar esses dados.
- Compartilhado: login, pedidos em banco, controle de revisão contra sobrescrita, trilha de alterações de pedidos e exportação pelo dono. Importação de backups para o banco não está implementada.
- Equipe: dono define função, acesso financeiro e ativação por pessoa. Produção com financeiro consulta valores sem editar pagamentos. Sem financeiro, a API entrega apenas dados operacionais. Contas precisam estar provisionadas previamente.
- Painel e Clientes (quem tem acesso financeiro): página inicial com faturamento previsto, recebido anotado, saldo, ticket médio, faturamento dos últimos 6 meses, mais vendidos, sinais pendentes, saldos em aberto e próximos 7 dias, por mês da data de entrega e sem cancelados. Clientes são agrupados pelo telefone (ou nome, sem telefone), com total comprado, saldo, última e próxima encomenda. Calculado no navegador a partir dos pedidos já carregados (`src/metrics.ts`), sem mudança no banco.
- Loja (dono): chave Pix e titular para as mensagens, antecedência mínima de itens sob orçamento e frete por bairro (`private.shop_settings`). O site lê só antecedência e bairros (`public_settings`); o servidor adiciona a linha de frete e recusa bairro desconhecido ou personalizado sem antecedência.
- WhatsApp: "Mensagem WhatsApp" em cada encomenda abre a conversa com confirmação pronta (itens, total, sinal ou saldo conforme o recebido e Pix). Envio é manual pelo WhatsApp de quem clica.
- Avisos: com o app aberto (aba visível a cada 10 s, em segundo plano a cada 30 s), pedido novo do site toca um som, mostra notificação se "Ativar avisos neste aparelho" foi aceito e coloca a contagem no título. Com o app fechado não há aviso (exigiria push com servidor).
- App instalável (PWA): manifesto, ícones e service worker (`public/sw.js`) só no build de produção; guarda apenas a casca do app, nunca pedidos.
- Site de pedidos ("Monte sua caixa", redesenhado com Impeccable): cards com fotos do catálogo só para produtos identificados com certeza (`public/products/`, origem embutida em cada `.json`), demais itens em cardápio; caixa fixa com total e sinal; fontes Gloock e Onest servidas pelo próprio build. Identidade documentada em DESIGN.md.
- Pedidos do site: `/pedido` é o formulário público para clientes (catálogo com estimativa e sinal de 50%, itens personalizados "sob orçamento", data, retirada/entrega e WhatsApp). O envio vira uma solicitação, não uma encomenda. Dono e atendimento com financeiro veem a aba "Pedidos do site", transformam em encomenda "A confirmar" (itens sem preço precisam ser orçados antes de salvar) ou descartam. Valores do cliente são apenas estimativa. Sem CAPTCHA: há campo-isca e limites no servidor (20 envios/10 min no total, 5/dia por telefone, 300 pendentes).
- Cupons, clientes e pronta entrega: dono configura cupons; equipe autorizada gerencia clientes e pronta entrega com foto/estoque. O site aplica cupom e reserva estoque; conversão em encomenda é atômica. Exportação CSV inclui só contatos autorizados, pelo dono. Regras, verificação e implantação em [GROWTH.md](GROWTH.md).

## Ambiente compartilhado local

Este ambiente de teste é independente do banco remoto. Requer Supabase CLI e Docker. Projeto isolado `saintcakes`, API54351, Postgres54352, e-mail de teste54354; faixa54350–54359 reservada. Não usar portas nem containers dos outros projetos.

```powershell
docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 saintcakes-local
supabase start --network-id saintcakes-local --exclude realtime,imgproxy,studio,edge-runtime,logflare,vector,supavisor,postgres-meta
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
supabase test db --local --network-id saintcakes-local
& ./supabase/tests/concurrent_revision.ps1
supabase db advisors --local --type security --level warn --fail-on error
```

Se o filtro RTK falhar ao interpretar o lint: `rtk proxy npm run lint`. Evidências reais e limitações: [VALIDATION.md](VALIDATION.md).

## Limites e próximos incrementos

Não há WhatsApp conectado, confirmação bancária, cobrança, emissão fiscal (NFC-e exige certificado A1, CSC da SEFAZ-SC, NCM do contador e serviço emissor), cálculo de frete por distância, kits ou topper. Frete por bairro e descontos configurados são descritos acima. Catálogo/regras em [CATALOG.md](CATALOG.md), produto em [PRODUCT.md](PRODUCT.md), identidade em [DESIGN.md](DESIGN.md). Observações/descrições são compartilhadas com a produção: não anotar nelas finanças sigilosas.

Antes de ampliar a operação: conferir provisionamento/recuperação de acesso, backup e restauração do banco; validar catálogo completo, personalizações e políticas comerciais; conferir segurança do ambiente e aparelhos. Auditoria atual é de pedidos, não de mudanças de permissão. Backend atual é para uma única confeitaria; desempenho em volume e dispositivos físicos não medido. Estado de implantação em GROWTH.md.

## Modelos e delegação

Coordenador integra e verifica. No primeiro incremento, Luna cuidou do domínio e da leitura do catálogo; Sol6.1 do formulário/revisão. No segundo, Sol6.1 alto cuidou do banco/permissões e Sol6.1 médio da autenticação/cliente; o risco de autorização justificou a escolha. Não foram contratadas APIs externas. Isso não mede economia comparativa; consumo por trabalhador não foi disponibilizado. Política: `../../../CONTEXT/AI-MODEL-ROUTING.md`.

## Publicação na Vercel

Projeto `ecapx/saintcakes`, Vite/Node24, build `npm run build`, saída `dist`. `vercel.json` mantém deep links e noindex. As duas variáveis VITE_SUPABASE ficam no painel Vercel, nunca em arquivos versionados. Builds Vercel exigem URLHTTPS e chave publishable para impedir publicação acidental do modo de demonstração. A configuração local em `.env.local` é independente.

Destino Supabase: `uzesslqldbuplovidgkq`, em conta própria e separada do XTAGE. Schema até `20261025130000` aplicado em 23/10/2026; cadastro público fechado. Mudanças futuras exigem autorização e acesso administrativo ao projeto. A chave publishable identifica o cliente, mas não autoriza migração ou configuração de Auth. Contas de equipe precisam ser provisionadas administrativamente.
