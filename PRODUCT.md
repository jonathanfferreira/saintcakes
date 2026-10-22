# Saint Cakes — encomendas

Aplicação para a pessoa que atende encomendas pelo WhatsApp e hoje transcreve para papel. Plataforma: web responsiva, validação local com modos de demonstração e compartilhado; modo da superfície: Operate.

## Confirmado na conversa

Nome, data, horário, entrega ou retirada, itens e valor total. Antecipação de 50% relatada no áudio fornecido. A folha genérica e a identidade visual foram enviadas como referência. O usuário autorizou desenvolver do zero e usar skills e delegação seletiva.

## Incremento funcional

Cadastrar/editar encomenda; calcular total/sinal/saldo; anotar valor recebido manualmente; consultar agenda por dia e todos os pedidos; pesquisar; atualizar andamento; resumir produção do dia; imprimir ficha; exportar e restaurar backup validado.

Datas, cliente e ao menos um item são obrigatórios. Endereço obrigatório para entrega. Itens por unidade, kg ou cento são uma proposta de modelagem, a validar. Valores registrados não comprovam recebimento bancário. Arredondar sinal de 50% para cima no centavo ímpar é uma suposição explícita deste incremento.

## Limites e decisões provisórias

O PDF enviado depois do início foi lido: 26 opções conferidas das páginas 3 e 17 estão disponíveis para preencher itens, com valores editáveis. É uma carga parcial, não o catálogo completo. Fonte e regras em CATALOG.md.

Modo demonstração: React/TypeScript/Vite para validar o fluxo com poucas dependências e sem custos de infraestrutura. localStorage versionado e backup JSON: apenas um navegador/origem, sem sincronização, autenticação ou garantia de disponibilidade. Mostrar esse escopo na interface. Sem seed automático; exemplos só por ação explícita do operador e identificados como fictícios.

Não é operação de produção. Banco remoto, catálogo completo, regras de personalização, horários/capacidade, confirmação bancária e WhatsApp continuam pendentes. Não criar catálogo, produtos, valores ou política comercial atribuídos à empresa sem fonte.

## Aceitação

Pedido sobrevive ao reload; edição não duplica; total e saldo corretos; filtros por data civil; cancelados fora da produção; sinal independente do andamento; importação inválida não apaga registros; falha de armazenamento impede confirmação falsa de salvamento; navegação por teclado; tela de 390px sem rolagem horizontal; impressão isolada da ficha.

## Segundo incremento: equipe e acesso individual

Usuários confirmados: prima do usuário no atendimento, dono e equipe. Correção explícita do usuário: o dono escolhe quais integrantes podem consultar o financeiro. A escolha é por pessoa; função e acesso financeiro são controles separados.

| Acesso | Consultar valores | Criar/editar e anotar recebimento | Atualizar produção | Gerenciar equipe |
| --- | --- | --- | --- | --- |
| Dono | Sim | Sim | Todas as etapas | Sim |
| Atendimento com financeiro | Sim | Sim | Todas as etapas | Não |
| Produção com financeiro | Sim | Não | Confirmado → em produção → pronto | Não |
| Integrante sem financeiro | Não | Não | Confirmado → em produção → pronto | Não |

Membros sem financeiro recebem somente informações operacionais. O DTO não contém preços, recebido, telefone nem endereço. Observações e descrições livres continuam visíveis à produção; não registrar informação financeira sigilosa nesses textos. Ver valores não permite editar pagamentos. O dono mantém acesso financeiro e não pode alterar o próprio perfil; pode desativar ou alterar outros integrantes previamente provisionados.

Modo compartilhado usa Supabase Auth e Postgres local. RPCs consultam membership ativa no banco, validam os valores e exigem revisão para edição. Números e criação vêm do servidor. Leitura periódica a cada 10 segundos em aba visível e atualização manual. Não é sincronização instantânea nem modo offline: falha de rede não confirma salvamento; conflito recusa sobrescrita e preserva o rascunho.

Demonstração local continua disponível sem configuração Supabase. Pedidos do navegador não são enviados ao banco, nem backups restaurados automaticamente. O backup compartilhado é somente exportação pelo dono neste incremento. Não há exclusão de pedido: cancelamento preserva histórico.

Schema é de uma única confeitaria. Autenticação e membership exigem provisionamento administrativo; a tela Equipe gerencia contas já provisionadas. Cadastro/convite por interface, auditoria de mudanças de acesso, recuperação de senha, implantação, backup/restore do banco e uso real em aparelhos distintos ainda precisam de incremento próprio. Auditoria atual registra criação/edição/andamento de pedido.

Aceitação adicional: permissões conferidas no banco; produção sem financeiro não recebe chaves financeiras pela API; membro não se promove por metadados; retirada de permissão bloqueia a próxima consulta; tela abandona dados financeiros ao atualizar o perfil; edição concorrente conserva a versão vencedora; logout limpa dados exibidos.
