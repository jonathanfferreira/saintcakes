# Catálogo de referência

Fonte fornecida pelo usuário em 22/10/2026: `C:\Users\fferr\Downloads\Catálogo Saint Cakes 26.pdf`, 27 páginas, 61.894.876 bytes. Texto extraído localmente; páginas de produtos e regras renderizadas e conferidas visualmente. Nenhuma cópia do PDF em public/, nenhuma extração enviada a serviços externos.

## O que entrou neste incremento

`src/catalog.ts` contém **26 opções iniciais** conferidas nas páginas 3 e 17: 11 sabores de bolo linha party com preço por kg e 15 mini salgados com preço por unidade. A lista é parcial. O formulário permite selecionar para preencher descrição, unidade e preço, e depois ajustar o combinado com o cliente. Escolher uma opção não altera encomendas já salvas. Valores são a transcrição do arquivo enviado, sem garantia de atualização posterior.

Não foram cadastrados automaticamente produtos sem preço fechado, adicionais condicionais, kits ou descontos por quantidade. Essas opções exigem modelagem e conferência próprias; podem ser lançadas manualmente com o valor combinado.

## Regras documentadas no PDF

- Página 2: personalizados pedem pelo menos dois dias de antecedência; pagamentos por Pix, cartão e dinheiro; cancelamento de personalizados cobra taxa do topper, sem especificar o valor aplicável; orçamentos de segunda a sábado, 08h às 19h30; entregas de segunda a domingo.
- Página 8: personalizados sob orçamento, com opções de topo e adicionais; não presumir que todos têm o mesmo preço/kg ou que todo topo é adicional.
- Página 14: mini fritos têm valores próprios e faixas por quantidade. Não estender esses descontos aos mini salgados da página 17.
- Página 27: entregas em Joinville e região; cobertura e frete não estão detalhados.
- Antecipação de 50% vem do áudio relatando a operação, não do PDF. As duas fontes permanecem distintas.

Neste incremento essas regras estão documentadas; não há bloqueio automático de datas nem cálculo de topper/frete/desconto. Aplicá-las exige confirmar detalhes e exceções com a operação.
