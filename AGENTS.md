# Saint Cakes — desenvolvimento

Siga também as instruções ECAPX e `CONTEXT/AI-MODEL-ROUTING.md` do workspace. Leia PRODUCT.md e DESIGN.md antes de alterar fluxos ou identidade.

- React + TypeScript + Vite; modo de demonstração em localStorage e modo compartilhado com Supabase Auth/Postgres. O backend foi aplicado somente à pilha local `saintcakes`, portas 54350–54359. Não apresentar como publicado ou pronto para operação real.
- Dono administra acessos; atendimento com financeiro cria/edita pedidos e anota pagamentos; produção atualiza apenas confirmado → em produção → pronto. Acesso financeiro é configurável POR PESSOA, nunca liberado automaticamente para a equipe toda. Dono mantém acesso financeiro; ninguém altera o próprio acesso.
- Sem permissão financeira, o servidor retorna apenas a projeção operacional, sem preço/recebido/contato/endereço. Ocultar botões não é autorização. Membership ativa no banco é a autoridade, nunca metadados editáveis do usuário/JWT. Texto livre é visível à produção; não colocar informação financeira sigilosa nas observações/descrições.
- Dados locais do navegador e compartilhados ficam separados; nunca enviar backups/exemplos locais ao banco automaticamente. Não importar pedidos reais sem necessidade/autorização; exemplos e verificações usam pessoas fictícias.
- Tabelas privadas com RLS deny-all e acesso somente por RPCs com checagem explícita; consultar `supabase/SECURITY.md`. Chave privilegiada nunca em variável VITE_/navegador. Signup público desabilitado; contas exigem provisionamento administrativo.
- Edições exigem a revisão capturada ao abrir o formulário; conflito mantém rascunho e recusa sobrescrita. Número e criação do pedido são controlados pelo servidor. Aplicar mudanças do banco por novas migrações; não reescrever migrações aplicadas.
- Valores em centavos inteiros, sinal proposto de 50% arredondado para cima no centavo ímpar. Pagamento é anotação manual; nunca declarar Pix confirmado pelo sistema.
- Datas de encomenda são datas civis locais, não UTC. Operação e pagamento têm estados separados.
- Persistência precisa falhar de forma visível sem apagar dados existentes. Exportação e importação validada devem permitir recuperação local.
- Não redesenhar a marca: usar logo fornecida, creme, marrom e dourado. Controles acessíveis e legíveis no celular.
- Verificar mudanças de lógica com testes de fronteira. Executar `npm test`, `npm run typecheck`, `npm run lint` e `npm run build`; para banco/permissões, executar pgTAP local, concorrência e advisors, além de contas separadas no navegador/API. Não afirmar conformidade WCAG integral por uma inspeção pontual.
- Não publicar, criar recursos remotos, conectar WhatsApp, comprar serviços ou alterar produção por inferência.
