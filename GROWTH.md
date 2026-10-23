# Cupons, clientes e pronta entrega

Retomada do trabalho do Claude em 23/10/2026, na branch `feat/cupons-clientes-vitrine`, sobre `fe36d46`. O pedido confirmado foi permitir que a própria loja configure cupons, principalmente de primeira compra, mantenha um cadastro dos clientes e ofereça pronta entrega no link de pedidos. Publicação autorizada pelo usuário em 23/10/2026; confira o commit e alias da Vercel para identificar a versão servida.

## Operação

- **Cupons:** somente o dono cadastra, edita ou desativa. Percentual de 1–90% ou valor fixo, mínimo, validade civil em São Paulo, limite de usos e opção de primeiro pedido. Telefone com/sem +55 é normalizado. A regra atual considera histórico de encomendas e solicitações não descartadas; não comprova a identidade de quem controla o telefone. O desconto exclui frete e itens ainda sem orçamento, não pode arredondar para zero nem zerar o pedido.
- **Clientes:** dono e atendimento com financeiro consultam e editam notas/consentimento. Pedidos alimentam o cadastro; a migração importa contatos históricos sem criar consentimento nem sobrescrever cadastros existentes. Autorizações guardam data e origem. Há um único editor por cliente nas duas apresentações responsivas. `patch_customer` exige revisão e retorna o cadastro completo; não usar a RPC legada `save_customer` em novos clientes da API.
- **Marketing:** checkbox do site começa desmarcado. A equipe só marca se houve autorização. O dono exporta somente contatos autorizados; células de CSV são protegidas contra fórmulas de planilha. Apagar o cadastro de marketing preserva os pedidos; um novo pedido pode recriar o cadastro sem consentimento. Não há envio de campanha nem WhatsApp conectado.
- **Pronta entrega:** dono e atendimento com financeiro cadastram nome, descrição, preço, unidade, estoque, ordem e foto. Foto é reduzida no navegador e enviada ao bucket público `vitrine`; não enviar documentos ou fotos privadas ali. O público vê apenas itens ativos com estoque. Edições enviam o timestamp `updatedAt` exato; uma reserva ou edição concorrente invalida a tela antiga.
- **Reserva:** envio válido debita estoque e consome o cupom na mesma transação. Descartar uma solicitação ainda nova devolve ambos. A reserva não tem expiração automática. Ao converter, estoque permanece consumido e o desconto fica registrado. Quantidade/unidade/ID das linhas reservadas são preservados, inclusive nas edições posteriores; alterações de composição exigem conferência operacional, não edição silenciosa da reserva. Cancelar uma encomenda convertida não repõe estoque automaticamente.
- **Conversão:** `convert_order_request` grava encomenda, auditoria, resolução e vínculo em uma transação. Falha desfaz tudo; chamadas concorrentes criam no máximo uma encomenda. Nunca recomendar descartar uma solicitação após uma gravação parcial.
- **Falhas:** queda de leitura da vitrine preserva a seleção. Após erro de estoque, o reenvio aguarda atualização e conferência das quantidades, nos botões de desktop e celular. Respostas antigas de leitura/cupom são descartadas.

Valores recebidos continuam sendo anotações manuais. Catálogo enviado pelo cliente é estimativa sujeita à revisão da equipe; preços da vitrine e desconto aplicado ao envio vêm do banco. Dados de demonstração não são enviados automaticamente.

## Banco e compatibilidade

`20261025120000_customers_coupons_showcase.sql` já estava aplicado localmente pelo Claude; foi preservado. As correções foram adicionadas em `20261025130000_growth_safety.sql`: CAS de vitrine/clientes, conversão atômica, vínculo e proteção de reserva, desconto mínimo e importação do histórico. Ambas foram aplicadas ao projeto remoto `uzesslqldbuplovidgkq` em uma transação em 23/10/2026, antes do frontend; histórico registrado com o SQL original. Contagens e resumos de integridade dos pedidos e solicitações permaneceram iguais. Publicar o frontend sem essas funções pode interromper as novas telas.

Destino de publicação: GitHub `jonathanfferreira/saintcakes`, branch `main`; Vercel `ecapx/saintcakes`, alias `https://saintcakes-ebon.vercel.app`. A verificação remota confirmou todas as tabelas privadas com RLS, nenhum acesso direto de anon/authenticated a clientes, nenhuma permissão anônima para listar clientes/converter pedidos, helpers privados não executáveis e nenhuma função pública SECURITY DEFINER da aplicação. Não foram usados pedidos fictícios na produção para testar o envio.

Tabelas privadas continuam com RLS e sem acesso direto por `anon`/`authenticated`; RPCs consultam membership ativa. Produção, inclusive com financeiro, não gerencia clientes, cupons ou estoque. Fotos são públicas; upload exige editor autorizado. Signup de equipe continua administrativo.

## Verificação em 23/10/2026

Executados localmente: 50 testes Node; 235 testes pgTAP; typecheck; lint; build; advisors de banco sem apontamentos; duas conexões reais para revisão concorrente. Também foram verificadas disputas por última unidade, último uso de cupom e conversão da mesma solicitação, com um vencedor em cada caso; importação do histórico com rollback preservando consentimento existente.

No navegador, com contas e clientes fictícios: criar cupom/produto, enviar foto, usar cupom no pedido móvel, reservar estoque, recusar edição antiga, converter em encomenda e retirar consentimento antes de mudar de desktop para celular. Simulação de indisponibilidade preservou a seleção e bloqueou o envio até recuperar o estoque. Telas de 390px sem rolagem horizontal nos fluxos conferidos; não é certificação integral de acessibilidade.

Roteamento: ferramentas determinísticas para buscas e checks, Sol6.1 high na revisão/implementação SQL e Sol6.1 medium na revisão independente de frontend; integração e aceitação pelo coordenador. Consumo por agente e economia comparativa não foram medidos. Nenhuma API paga adicional foi contratada.
