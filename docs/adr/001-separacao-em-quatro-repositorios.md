# ADR-001 · Separação em quatro repositórios

**Status:** Aceita
**Data:** 2026-09-15
**Contexto do Tech Challenge:** Fase 3

## Contexto

Até a Fase 2 o projeto vivia em um único repositório: aplicação, manifestos Kubernetes, Terraform e pipeline juntos. Isso funcionava porque a infraestrutura era local (cluster kind) e tinha o mesmo ciclo de vida da aplicação.

Na Fase 3 a infraestrutura passa a ser real e persistente na nuvem. Os ciclos de vida divergem: a aplicação muda várias vezes por dia, o cluster muda a cada semanas, o banco quase nunca. Um `terraform apply` acidental disparado por um commit de aplicação pode derrubar o banco de produção.

O enunciado exige explicitamente quatro repositórios separados, cada um com CI/CD próprio e deploy automático.

## Decisão

Separar em quatro repositórios, por **ciclo de vida e raio de destruição**:

| Repositório | Conteúdo | Frequência de mudança | Raio de destruição |
| --- | --- | --- | --- |
| `oficina-api` | Aplicação NestJS, Deployment, HPA, imagem | Diária | Baixo — rollout reversível |
| `oficina-lambda-auth` | Funções de autenticação, Terraform próprio | Semanal | Baixo — funções versionadas |
| `oficina-infra-k8s` | EKS, API Gateway, observabilidade | Mensal | Alto — derruba a plataforma |
| `oficina-infra-database` | RDS, Secrets Manager | Raríssima | **Crítico — perda de dados** |

O acoplamento entre eles é feito por **state remoto do Terraform em S3**, lido com `terraform_remote_state`, e por **outputs explícitos**. Nenhum repositório importa código de outro.

## Consequências

**Positivas**

- Um commit na aplicação não consegue tocar no banco. A separação é uma barreira física, não uma convenção.
- Cada pipeline roda o que interessa: a aplicação não espera 15 minutos de `terraform plan` para subir um hotfix.
- Permissões podem ser diferentes por repositório — quem mexe na API não precisa de acesso ao state do banco.
- O `terraform destroy` do fim do dia (necessário para preservar o crédito do laboratório) é feito repositório a repositório, na ordem certa.

**Negativas**

- Uma mudança que atravessa camadas exige PRs coordenados em mais de um repositório.
- A ordem de aplicação passa a importar: `database` → `lambda-auth` → `k8s` → `api`. Está documentada no README de cada um.
- O state remoto compartilhado vira uma dependência operacional: o bucket S3 e a tabela de lock precisam existir antes de qualquer `init`.

**Sobre a leitura como "microsserviços"**

A separação aqui é de **repositório e pipeline**, não de runtime. A aplicação permanece um único deployable — item 4 do enunciado, "Aplicação principal executando em Kubernetes", no singular. O único componente que de fato sai do processo principal é a autenticação, que vira function serverless por exigência explícita do desafio (ver [ADR-004](004-autenticacao-serverless.md)).

Fragmentar o domínio de oficina em serviços independentes (clientes, veículos, ordens) introduziria consistência eventual em invariantes que hoje são transacionais — em especial a baixa de estoque na aprovação do orçamento, que precisa ser atômica. Seria pagar o custo de sistemas distribuídos sem o volume que justifica.
