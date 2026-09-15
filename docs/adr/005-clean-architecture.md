# ADR-005 · Clean Architecture em quatro camadas

**Status:** Aceita (mantida da Fase 2)
**Data:** 2026-09-15

## Contexto

A aplicação foi estruturada em Clean Architecture na Fase 2. Na Fase 3, a migração para a nuvem trouxe mudanças de infraestrutura significativas: PostgreSQL em pod virou RDS gerenciado com TLS, e a autenticação ganhou um caminho serverless externo.

A decisão a registrar é se a estrutura se sustentou sob essas mudanças.

## Decisão

Manter a estrutura, com quatro camadas por bounded context:

```
src/modules/<contexto>/
├── domain/           entidades e regras puras, sem dependência de framework
├── application/      casos de uso e ports (interfaces)
├── infrastructure/   adapters — TypeORM, Nodemailer
└── presentation/     controllers, DTOs, presenters
```

Os seis contextos: `auth`, `clientes`, `veiculos`, `servicos`, `pecas`, `ordens-servico`.

## Evidência de que a estrutura se pagou

A migração da Fase 2 para a Fase 3 é o teste empírico da decisão:

| Mudança de infraestrutura | Arquivos de domínio alterados |
| --- | --- |
| PostgreSQL em pod → RDS gerenciado com TLS | **Nenhum** — só a factory do TypeORM em `app.module.ts` |
| Cluster kind → EKS | **Nenhum** |
| NodePort → API Gateway com VPC Link | **Nenhum** |
| Instrumentação de métricas de negócio | Só `ordens-servico.service.ts`, na camada de aplicação |

As entidades de domínio (`OrdemServico`, `Cliente`, `Veiculo`, `Peca`, `Servico`) não foram tocadas. Os 72 testes de domínio e aplicação que existiam continuaram passando sem alteração.

## Consequências

**Positivas**

- Testes de domínio rodam sem banco, sem container e sem mock de framework. A suíte completa leva ~3 segundos.
- Trocar o adapter de notificação (Nodemailer → SES, por exemplo) é trocar uma classe que implementa `NotificacaoPort`. O domínio não sabe que existe e-mail.
- A regra de transição de status vive na entidade `OrdemServico`, não espalhada em controllers. Uma transição inválida é impossível de representar.

**Negativas**

- Mais arquivos por funcionalidade. Um CRUD simples atravessa quatro camadas — custo real em contextos como `servicos`, onde a regra de negócio é fina.
- O mapeamento entre entidade de domínio e entidade ORM é escrito à mão em cada repositório.

## Nota sobre a instrumentação

`MetricasService` foi injetado em `ordens-servico.service.ts`, na camada de **aplicação** — não no domínio. A entidade `OrdemServico` continua sem saber que existe Prometheus. É a camada de aplicação que observa o resultado das operações e emite as métricas, mantendo o domínio puro.
