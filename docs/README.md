# Documentação da Arquitetura

Documentação arquitetural do **Sistema Integrado de Atendimento e Execução de Serviços** — Tech Challenge SOAT, Fase 3.

## Índice

### Visão geral
- [Diagrama de Componentes](ARQUITETURA.md#diagrama-de-componentes) — visão de nuvem, APIs, banco e monitoramento
- [Diagramas de Sequência](ARQUITETURA.md#diagramas-de-sequência) — autenticação e abertura de ordem de serviço
- [Modelagem de Dados](MODELAGEM.md) — diagrama ER, relacionamentos e justificativa do banco

### Decisões

**ADRs** — decisões arquiteturais permanentes:

| # | Decisão | Status |
| --- | --- | --- |
| [ADR-001](adr/001-separacao-em-quatro-repositorios.md) | Separação em quatro repositórios | Aceita |
| [ADR-002](adr/002-comunicacao-sincrona-rest.md) | Comunicação síncrona via REST | Aceita |
| [ADR-003](adr/003-escalabilidade-com-hpa.md) | Escalabilidade horizontal com HPA | Aceita |
| [ADR-004](adr/004-autenticacao-serverless.md) | Autenticação serverless com authorizer Lambda | Aceita |
| [ADR-005](adr/005-clean-architecture.md) | Clean Architecture em quatro camadas | Aceita |

**RFCs** — propostas técnicas com alternativas avaliadas:

| # | Proposta |
| --- | --- |
| [RFC-001](rfc/001-escolha-da-nuvem.md) | Escolha do provedor de nuvem |
| [RFC-002](rfc/002-escolha-do-banco-de-dados.md) | Escolha do banco de dados |
| [RFC-003](rfc/003-estrategia-de-autenticacao.md) | Estratégia de autenticação |
| [RFC-004](rfc/004-observabilidade.md) | Stack de observabilidade |

## Como ler

Os **RFCs** registram a avaliação de alternativas — o que foi considerado e por quê foi descartado. Os **ADRs** registram a decisão final e suas consequências. Quando um RFC leva a uma decisão, o ADR correspondente o referencia.
