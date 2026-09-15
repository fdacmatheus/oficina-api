# ADR-002 · Comunicação síncrona via REST

**Status:** Aceita
**Data:** 2026-09-15

## Contexto

O sistema tem quatro pontos de comunicação entre componentes:

1. Consumidor externo → API Gateway
2. API Gateway → Lambda de autenticação
3. API Gateway → aplicação no EKS (via VPC Link)
4. Aplicação → notificação por e-mail ao cliente

Era preciso decidir se algum deles deveria ser assíncrono, com fila ou tópico.

## Decisão

Manter **REST síncrono** nos pontos 1 a 3, e tratar a notificação (ponto 4) como **best effort** dentro do mesmo processo.

Nenhuma fila ou broker foi introduzido.

## Justificativa

Toda operação do fluxo é **interativa**: o atendente abre a OS e precisa do número na tela; o cliente consulta o status e espera a resposta; o sistema terceiro aprova o orçamento e precisa saber se a baixa de estoque deu certo. Não há operação onde "aceito, processo depois" seja aceitável do ponto de vista do negócio.

A aprovação do orçamento é o caso mais ilustrativo. Ela precisa, na mesma transação:

- validar a transição de status,
- dar baixa no estoque de todas as peças,
- persistir a OS.

Se qualquer etapa falhar, nada pode ter acontecido. Uma fila entre a decisão e a baixa de estoque transformaria essa invariante em consistência eventual, exigindo compensação — complexidade real, em troca de um desacoplamento que o volume não pede.

A **notificação por e-mail** é a única operação genuinamente tolerante a atraso, e é tratada como tal: a falha de SMTP incrementa `oficina_integracao_falhas_total{integracao="email"}`, dispara alerta e **não reverte** a transição de status. Ela é assíncrona na semântica, sem precisar de infraestrutura assíncrona.

## Consequências

**Positivas**

- Erros aparecem na resposta HTTP, no momento em que acontecem. Sem rastrear mensagens em dead letter queue.
- Uma transação de banco cobre a invariante inteira.
- Menos infraestrutura: sem SQS, sem SNS, sem consumidores para operar e monitorar — e sem custo adicional no crédito do laboratório.

**Negativas**

- A latência do SMTP entra no tempo de resposta da transição de status. Mitigado pelo `try/catch` que não bloqueia o fluxo.
- Um pico de tráfego é absorvido por escala horizontal (HPA), não por enfileiramento. Aceitável: o teto de 6 réplicas cobre com folga a carga de uma rede de oficinas.

## Quando revisitar

Se a notificação evoluir para múltiplos canais (e-mail + SMS + push) ou se surgir integração com sistemas de terceiros que exijam retry com backoff persistente, uma fila passa a se pagar. O ponto de extensão já existe: `NotificacaoPort` é uma interface, e trocar o adapter de Nodemailer por um publisher de SNS não toca no domínio.
