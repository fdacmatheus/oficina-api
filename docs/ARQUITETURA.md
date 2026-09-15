# Arquitetura

## Diagrama de Componentes

Visão de nuvem completa: entrada, computação, dados e monitoramento.

```mermaid
flowchart TB
    subgraph EXT["Consumidores"]
        APP[Aplicativo do cliente]
        ADM[Painel da oficina]
        TER[Sistema terceiro<br/>webhook de orçamento]
    end

    subgraph AWS["AWS · us-east-1"]
        subgraph BORDA["Camada de borda"]
            GW["API Gateway HTTP API<br/>throttling 100 rps · burst 200<br/>logs de acesso em JSON"]
            AUTHZ{{"Lambda Authorizer<br/>valida JWT · cache 5 min"}}
            GW -.rotas protegidas.-> AUTHZ
        end

        subgraph SERVERLESS["Autenticação serverless"]
            LTOKEN["Lambda oficina-auth-token<br/>valida CPF · emite JWT<br/>Node 20 · 512 MB"]
        end

        subgraph COMPUTE["Amazon EKS 1.31"]
            VPCL[VPC Link]
            NLB["NLB interno<br/>sem exposição pública"]

            subgraph NS_OFICINA["namespace oficina"]
                DEP["Deployment oficina-api<br/>NestJS · 2 a 6 réplicas"]
                HPA["HPA<br/>CPU 60% · memória 75%"]
                PDB[PodDisruptionBudget]
                CM[ConfigMap]
                SEC[Secret]
                HPA -.escala.-> DEP
                CM -.envFrom.-> DEP
                SEC -.envFrom.-> DEP
            end

            subgraph NS_MON["namespace monitoring"]
                PROM["Prometheus<br/>retenção 6h"]
                GRAF["Grafana<br/>dashboards como código"]
                ALERT[Alertmanager]
                PROM --> GRAF
                PROM --> ALERT
            end

            MS[metrics-server]
            MS -.CPU e memória.-> HPA
            PROM -.scrape 15s<br/>/api/metrics.-> DEP
        end

        subgraph DADOS["Camada de dados"]
            RDS[("RDS PostgreSQL 16<br/>db.t3.micro · gp3 20 GB<br/>criptografado · multi-AZ subnets")]
            SM["Secrets Manager<br/>credenciais e segredo JWT"]
        end

        CWL["CloudWatch Logs<br/>gateway + lambdas"]
        ECR["ECR<br/>imagens da aplicação"]
    end

    APP --> GW
    ADM --> GW
    TER --> GW

    GW -->|POST /auth| LTOKEN
    GW -->|"/api/**"| VPCL
    VPCL --> NLB
    NLB --> DEP

    LTOKEN --> RDS
    LTOKEN --> SM
    AUTHZ --> SM
    DEP --> RDS
    SM -.-> SEC
    ECR -.pull.-> DEP

    GW --> CWL
    LTOKEN --> CWL
    AUTHZ --> CWL
```

### Responsabilidade de cada repositório

| Componente | Repositório |
| --- | --- |
| API Gateway, VPC Link, EKS, NLB, Prometheus, Grafana, Alertmanager | `oficina-infra-k8s` |
| Lambda de token, Lambda authorizer, segredo JWT | `oficina-lambda-auth` |
| RDS PostgreSQL, Secrets Manager das credenciais | `oficina-infra-database` |
| Deployment, HPA, PodDisruptionBudget, ConfigMap, imagem | `oficina-api` |

---

## Diagramas de Sequência

### Autenticação por CPF

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant GW as API Gateway
    participant LT as Lambda token
    participant SM as Secrets Manager
    participant DB as RDS PostgreSQL

    C->>GW: POST /auth<br/>{ "cpf": "529.982.247-25" }
    GW->>GW: rota pública, sem authorizer
    GW->>LT: invoca (payload 2.0)

    LT->>LT: valida dígitos verificadores

    alt CPF inválido
        LT-->>C: 400 CPF_INVALIDO
    end

    LT->>SM: GetSecretValue(credenciais)
    note right of LT: cache por container:<br/>só na primeira invocação
    SM-->>LT: host, usuário, senha

    LT->>DB: SELECT id, nome, documento<br/>FROM clientes WHERE documento = $1
    DB-->>LT: registro do cliente

    alt cliente não cadastrado
        LT-->>C: 404 CLIENTE_NAO_ENCONTRADO
    end

    LT->>SM: GetSecretValue(oficina/auth/jwt)
    SM-->>LT: segredo HS256
    LT->>LT: assina JWT<br/>{ sub, username, nome, tipo }<br/>exp 15 min

    LT-->>C: 200 { accessToken, expiresIn: 900, cliente }
```

### Consumo de rota protegida

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant GW as API Gateway
    participant AZ as Lambda Authorizer
    participant API as Oficina API (EKS)

    C->>GW: GET /api/ordens-servico<br/>Authorization: Bearer <token>

    alt resposta já em cache (5 min)
        GW->>GW: reutiliza a autorização
    else primeira chamada
        GW->>AZ: invoca com o cabeçalho
        AZ->>AZ: verifica assinatura e expiração
        alt token inválido ou expirado
            AZ-->>GW: isAuthorized: false
            GW-->>C: 401 Unauthorized
        end
        AZ-->>GW: isAuthorized: true<br/>context { clienteId, username }
    end

    GW->>API: encaminha via VPC Link<br/>x-amzn-requestid propagado
    API->>API: CorrelacaoMiddleware<br/>adota o requestId como correlationId
    API-->>C: 200 lista de ordens<br/>x-correlation-id
```

### Abertura de ordem de serviço

```mermaid
sequenceDiagram
    autonumber
    actor A as Atendente
    participant GW as API Gateway
    participant API as OrdensServicoService
    participant CLI as ClientesService
    participant VEI as VeiculosService
    participant PEC as PecasService
    participant DB as RDS PostgreSQL
    participant MET as Métricas
    participant SMTP as Notificação

    A->>GW: POST /api/ordens-servico<br/>{ clienteId, veiculoId, servicos[], pecas[] }
    GW->>API: rota protegida, já autorizada

    API->>CLI: findById(clienteId)
    CLI->>DB: SELECT
    DB-->>CLI: cliente

    API->>VEI: findById(veiculoId)
    VEI-->>API: veículo

    alt veículo não pertence ao cliente
        API-->>A: 400 Bad Request
    end

    loop cada serviço
        API->>API: adicionarItem(SERVICO)
    end
    loop cada peça
        API->>PEC: findById(pecaId)
        API->>API: adicionarItem(PECA)
    end

    API->>API: calcula o orçamento

    API->>DB: INSERT ordem_servico + itens
    alt falha de persistência
        API->>MET: oficina_ordem_servico_erros_total{operacao="criar"}
        API-->>A: 500
    end
    DB-->>API: OS com id e número

    API->>MET: oficina_ordens_servico_criadas_total++
    API->>MET: transicoes{de:"NENHUM", para:"RECEBIDA"}

    API-->>A: 201 { id, numero, status: RECEBIDA, orcamento }

    note over A,SMTP: Fluxo posterior — aprovação do orçamento

    A->>GW: POST /api/publico/ordens-servico/{numero}/orcamento<br/>{ "aprovado": true }
    GW->>API: rota pública (webhook)
    API->>PEC: saidaEstoque por peça
    alt estoque insuficiente
        API->>MET: erros{operacao="baixa-estoque"}
        API-->>A: 400
    end
    API->>DB: UPDATE status = EM_EXECUCAO
    API->>MET: transicoes{de:"AGUARDANDO_APROVACAO", para:"EM_EXECUCAO"}
    API->>SMTP: notifica o cliente
    alt SMTP indisponível
        API->>MET: integracao_falhas{integracao="email"}
        note right of API: best effort:<br/>a transição não é revertida
    end
    API-->>A: 200 OS em execução
```

---

## Fluxo de estados da ordem de serviço

```mermaid
stateDiagram-v2
    [*] --> RECEBIDA: abertura da OS
    RECEBIDA --> EM_DIAGNOSTICO: iniciar diagnóstico
    EM_DIAGNOSTICO --> AGUARDANDO_APROVACAO: solicitar aprovação
    AGUARDANDO_APROVACAO --> EM_EXECUCAO: webhook aprova<br/>(baixa de estoque)
    AGUARDANDO_APROVACAO --> CANCELADA: webhook recusa
    EM_EXECUCAO --> FINALIZADA: finalizar
    FINALIZADA --> ENTREGUE: entregar
    ENTREGUE --> [*]
    CANCELADA --> [*]

    note right of AGUARDANDO_APROVACAO
        Cada transição dispara
        notificação por e-mail
        e incrementa a métrica
        de transições
    end note
```

A listagem de `GET /api/ordens-servico` ordena por **Em Execução > Aguardando Aprovação > Diagnóstico > Recebida**, mais antigas primeiro, e oculta `FINALIZADA`, `ENTREGUE` e `CANCELADA`.

---

## Fluxo de CI/CD

```mermaid
flowchart LR
    subgraph DEV["Desenvolvimento"]
        BR[branch de feature] --> PR[Pull Request]
    end

    subgraph CI["Integração contínua"]
        PR --> L[ESLint]
        PR --> T[Jest · 76 testes]
        PR --> B[nest build]
        PR --> K[validação dos manifestos]
    end

    subgraph CD["Entrega contínua"]
        M[merge em main] --> IMG[build da imagem]
        IMG --> ECR[(ECR<br/>tag = SHA do commit)]
        ECR --> APL[kubectl apply]
        APL --> RO[rollout status]
        RO --> SMOKE[smoke test<br/>/api/health e /api/metrics]
    end

    PR -.aprovação obrigatória.-> M
```

A branch `main` é protegida: sem commits diretos, merge apenas por Pull Request. A branch `homolog` faz o mesmo caminho para o ambiente de homologação.
