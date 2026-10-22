# Verificações de desenvolvimento

Data: 22/10/2026. Somente dados fictícios, navegador de testes sem login.

## Checagens executadas

- Testes Node do domínio e armazenamento: **19/19 passaram**, cobrindo moeda, quantidade/unidade, sinal em centavo ímpar, saldo, limites, datas/bissexto, importação malformada, IDs duplicados, falhas de quota e revisão desatualizada.
- TypeScript `tsc --noEmit`, lint Oxlint e build Vite executados. Lint pelo comando `rtk proxy npm run lint` devido a erro do filtro do harness.
- `npm audit --omit=dev --audit-level=moderate`: zero vulnerabilidades reportadas nas dependências de produção. Não equivale a auditoria completa de segurança.
- Revisão independente encontrou quatro falhas: data extrema no calendário, arredondamento da impressão, corrida durante leitura de backup e IDs de itens duplicados. Correções implementadas e verificadas.

## Navegador

- Cadastrar pedido de R$145,01 com recebido R$72,51: sinal R$72,51 e saldo R$72,50. Persistência após reload; edição preserva o número de pedidos.
- Valor recebido superior ao total impede salvamento; entrega sem endereço aciona validação.
- Confirmado aparece na produção; cancelado fica de fora. Impressão mostra a ficha e oculta a interface da agenda; PDF intermediário de teste foi gerado.
- Backup válido restaura sem duplicar; arquivo inválido não altera dados.
- Leitura de backup artificialmente atrasada, seguida de cadastro: app recusa importação desatualizada e preserva o cadastro novo.
- Data 9999-12-31 não derruba o calendário; botão de próximo dia fica desabilitado.
- Catálogo: Bolo Sensação, R$89/kg, quantidade2,5 → totalR$222,50, sinalR$111,25. Unidade/preço/descrição preenchidos pelo seletor.
- Desktop1440px e celular390px inspecionados; agenda/formulário sem rolagem horizontal, inclusive após adicionar o seletor do catálogo.

Screenshots e dados de teste ficam em verification/ (ignorado). O banco local de QA do Playwright não é compartilhado automaticamente com a prévia do usuário.

## Limitações da inspeção inicial

Não testados naquela etapa: operação multiusuário, backend, WhatsApp, banco/Pix, desempenho em celular físico, leitores de tela e bateria WCAG completa. O detector Impeccable apontou apenas duas advertências sobre Arial; a fonte local provisória está documentada em DESIGN.md. Não trocar a tipografia da marca ou adicionar fonte remota por esse aviso.

## Segundo incremento: equipe e financeiro individual

22/10/2026. Aplicado somente à pilha Docker local Saint Cakes, projeto `saintcakes`. Nenhum projeto remoto criado, nenhuma migração remota ou publicação. Testes usam identidades e pedidos fictícios; credenciais de QA ficaram em memória e não são parte do código/fixtures persistidas.

- `npm test`: **25/25 passaram**, incluindo seis testes do cliente compartilhado (configuração inválida/segredos, projeção por whitelist, resposta malformada, validação e mensagens).
- `supabase test db --local --network-id saintcakes-local supabase/tests/shared_orders.test.sql`: **79/79 passaram** na execução final, inclusive com outro pedido fictício no banco. A suíte não depende de banco vazio; transação com rollback.
- `supabase/tests/concurrent_revision.ps1`: **PASS** com duas conexões reais, espera pelo lock observada, segunda edição recusada, valor/revisão/auditoria vencedores preservados. Limpeza dos UUIDs fictícios do teste concluída.
- `supabase db advisors --local --type security --level warn --fail-on error`: nenhum problema reportado.
- TypeScript, Oxlint via RTK proxy e build Vite passaram. `npm audit --omit=dev --audit-level=moderate`: zero vulnerabilidades reportadas; não equivale a auditoria completa.
- Revisão encontrou validação incorreta de string vazia no helper UTF16 e endereço feito só de espaços de controle/Unicode. Corrigidos por duas novas migrações, sem reescrever a inicial aplicada; regressões no pgTAP.

### Navegador e API reais

Chrome local de testes com contextos separados para dono, atendimento e produção. Autenticação real contra Auth local, chamadas HTTP com tokens reais; não apenas mock de papel.

- Atendimento cadastrou R$145,01, recebido R$72,51; dono viu pedido compartilhado e saldoR$72,50. Produção avançou andamento e a outra sessão recebeu a atualização.
- Produção sem financeiro não exibiu valores e a resposta RPC operacional não continha `unitPriceCents`/`receivedCents`. Endpoint financeiro recusou a chamada desse usuário.
- Dono marcou financeiro somente para o integrante de produção; este passou a consultar valores/ficha e continuou sem botão de cadastrar/editar pagamentos. Desmarcar retirou a tela financeira na próxima atualização automática da aba visível.
- Desativar integrante recusou consulta com o token antigo e removeu pedidos da tela após atualizar. Reativação e logout com limpeza da interface conferidos.
- Anônimo e usuário autenticado sem membership foram recusados. Metadados de usuário com roleowner não concederam acesso. Autopromoção recusada. Signup público recusado e login de e-mail permitido.
- Dois formulários abertos: atendimento mudou recebido paraR$100; dono tentou salvar revisão antiga. Conflito explícito, rascunho mantido e recebidoR$100 preservado. Auditoria permaneceu com três eventos aceitos, sem evento da edição recusada.
- Financeiro, produção e equipe em390px sem overflow horizontal. Demonstração sem Supabase conferida após a mudança assíncrona do formulário: cadastro/reload local passaram e dados não foram enviados ao banco.

Evidências ignoradas em `verification/shared-result.json`, `team-access-*.png`, `shared-*.png`. Capturas representam exclusivamente fixtures fictícias, não contas da empresa.

### Correção de ocupação da tela relatada pelo usuário

O usuário enviou captura com faixa escura lateral no Chrome. Na inspeção DOM anterior, html/body/root não tinham altura mínima e a margem8vh do login propagava até body (top80px em viewport1440×1000). A faixa específica do compositor do Chrome do usuário não foi reproduzida no navegador de testes; a aba desse Chrome não estava disponível no conector.

Correção: raiz e corpo com largura100% e altura mínima de viewport, contexto que impede colapso de margem; login com superfície de tela inteira e cartão interno centralizado, sem margem externa. Impressão restaura altura automática para não introduzir folhas extras. Após correção, main/root da prévia aberta começam em0,0 e preenchem a área disponível.

Conferidos2520×1398,1920×1080,1365×950,390×844 e390×500: superfície cobre viewport, formulário centralizado e sem overflow horizontal. Screenshots `login-full-width-desktop.png`/`login-full-width-mobile.png`; medidas em `login-layout-result.json`. Tipos, lint, build,25 testes do app e79 do banco passaram depois da correção.

### Pendências para operação real

Sem publicação/banco remoto ou contas reais; cadastro/convite/recuperação de senha pela interface, auditoria de mudanças de acesso, backups/restauração do banco, volume, celular físico, leitor de tela e revisão completa de segurança/acessibilidade seguem pendentes. Mudanças de acesso são conferidas a cada RPC; dados já vistos, impressos ou exportados não podem ser recolhidos do aparelho. Texto livre continua visível à produção.
