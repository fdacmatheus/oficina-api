# RFC-001 · Escolha do provedor de nuvem

**Status:** Resolvido — AWS
**Data:** 2026-09-15

## Questão

O enunciado da Fase 3 dá liberdade de escolha de nuvem, exigindo API Gateway, function serverless, banco gerenciado, cluster Kubernetes com escalabilidade e provisionamento por Terraform.

Qual provedor atende com menor atrito e menor custo, dentro da restrição de **US$ 50 de crédito** do AWS Academy Learner Lab?

## Alternativas avaliadas

### AWS

| Requisito | Serviço |
| --- | --- |
| API Gateway | Amazon API Gateway (HTTP API) |
| Function serverless | AWS Lambda |
| Banco gerenciado | Amazon RDS for PostgreSQL |
| Kubernetes | Amazon EKS |
| IaC | Terraform, provider `hashicorp/aws` |

**A favor:** o crédito disponível é da AWS. O provider Terraform é o mais maduro do ecossistema. O laboratório já traz as roles de EKS pré-provisionadas.

**Contra:** o Learner Lab é restritivo — não concede `iam:CreateRole`, limita tipos de instância e libera apenas `us-east-1`. O control plane do EKS custa US$ 0,10/h, sem free tier.

### Google Cloud

| Requisito | Serviço |
| --- | --- |
| API Gateway | Cloud Endpoints / API Gateway |
| Function serverless | Cloud Functions |
| Banco gerenciado | Cloud SQL for PostgreSQL |
| Kubernetes | GKE Autopilot |

**A favor:** o GKE Autopilot dispensa gerenciar node groups, e o control plane zonal é gratuito. A experiência de Kubernetes é a melhor das três.

**Contra:** exigiria uma conta pessoal com cartão de crédito. O crédito de US$ 300 do trial cobriria, mas o desafio seria custeado do bolso após 90 dias, e o crédito do Learner Lab ficaria ocioso.

### Azure

| Requisito | Serviço |
| --- | --- |
| API Gateway | Azure API Management |
| Function serverless | Azure Functions |
| Banco gerenciado | Azure Database for PostgreSQL |
| Kubernetes | AKS |

**A favor:** control plane do AKS gratuito. API Management é o gateway mais completo dos três.

**Contra:** o tier Developer do API Management leva cerca de **40 minutos** para provisionar, o que tornaria cada ciclo de `apply`/`destroy` penoso. Mesmo problema de conta e custeio do GCP.

## Decisão

**AWS.**

O fator decisivo é o crédito: é o recurso escasso do projeto, e ele é da AWS. Usar outro provedor significaria pagar do próprio bolso enquanto US$ 50 ficam sem uso.

O segundo fator é o provider Terraform. Como a entrega exige três repositórios de infraestrutura versionada, a maturidade do `hashicorp/aws` — e o volume de documentação disponível para depurar — pesa mais do que a conveniência operacional do GKE Autopilot.

## Consequências e mitigações

| Restrição do Learner Lab | Mitigação adotada |
| --- | --- |
| Sem `iam:CreateRole` | Usar `LabRole`, `LabEksClusterRole` e `LabEksNodeRole` via `data source` |
| Só `us-east-1` | Região fixada como padrão em todas as variáveis |
| `us-east-1e` não suporta EKS | Filtro dinâmico de AZ em `locals.eks_subnet_ids` |
| EKS custa US$ 0,10/h | Ciclo curto: `apply` → demonstrar → `destroy` no mesmo dia |
| NAT Gateway custaria US$ 32/mês | VPC default com subnets públicas; isolamento por security group e NLB interno |
| Token expira a cada sessão | Os três secrets do GitHub Actions são reatualizados por sessão do laboratório |

### Custo estimado do ciclo completo

| Recurso | Custo/hora |
| --- | --- |
| EKS control plane | US$ 0,100 |
| 2 × EC2 `t3.medium` | US$ 0,083 |
| RDS `db.t3.micro` | US$ 0,017 |
| NLB × 2 (API + Grafana) | US$ 0,045 |
| **Total** | **~US$ 0,245/h** |

Um ciclo de demonstração de 4 horas custa cerca de **US$ 1,00**. Os US$ 50 comportam com folga o desenvolvimento, os ensaios e a gravação — **desde que o `destroy` seja executado ao fim de cada sessão.** Esquecer a infraestrutura ligada por uma semana consome US$ 41.
