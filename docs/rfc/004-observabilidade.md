# RFC-004 · Stack de observabilidade

**Status:** Resolvido — Prometheus + Grafana no cluster
**Data:** 2026-09-15

## Questão

O enunciado cita **Datadog ou New Relic** como exemplos, mas declara **escolha livre**. Exige monitorar latência das APIs, consumo de recursos do Kubernetes, healthchecks e uptime, alertas para falhas no processamento de ordens de serviço, logs estruturados em JSON com correlação, e dashboards com volume diário de OS, tempo médio por status e erros de integração.

## Alternativas avaliadas

### Datadog

**A favor:** o produto mais completo do mercado — APM, logs, métricas e traces integrados. Agente instala por Helm em minutos. Dashboards excelentes prontos.

**Contra:**
- Exige conta e API key. O trial é de 14 dias; depois, US$ 15 a 31 por host/mês.
- Com 2 a 4 nodes, o custo sairia de US$ 30 a 124/mês — inviável para o projeto.
- **Os dashboards vivem fora do repositório.** Reproduzir o ambiente exigiria recriá-los manualmente ou exportar JSON e importar à mão.

### New Relic

**A favor:** free tier generoso e permanente — 100 GB/mês de ingestão e um usuário completo. Atende literalmente o exemplo do enunciado. Instalação por Helm.

**Contra:**
- Ainda exige cadastro e license key, que vira mais um secret a gerenciar.
- Mesmo problema de fundo: **dashboards fora do controle de versão**. A infraestrutura como código pararia na borda do monitoramento.
- Os dados saem para um terceiro; não é bloqueante aqui, mas é uma dependência externa a mais na demonstração.

### CloudWatch Container Insights

**A favor:** nativo AWS, sem cadastro, integrado aos logs do API Gateway e das Lambdas que já vão para lá.

**Contra:**
- **Consome crédito do laboratório** — cobra por métrica customizada e por GB ingerido, e o crédito é o recurso escasso.
- Dashboards pobres para o que o enunciado pede. Métricas de negócio (volume diário de OS, tempo médio por status) exigiriam publicar métricas customizadas via API, uma a uma.
- Sem PromQL; as agregações pedidas ficariam engessadas.

### Prometheus + Grafana no cluster — **escolhida**

Chart `kube-prometheus-stack`: Prometheus, Alertmanager, Grafana, node-exporter e kube-state-metrics em um release.

**A favor:**
- **Dashboards como código.** Os painéis vivem em `dashboards/*.json` no repositório `oficina-infra-k8s` e são carregados pelo sidecar do Grafana a partir de ConfigMaps. Um `terraform apply` reproduz o ambiente inteiro, dashboards inclusos.
- **Alertas como código.** As `PrometheusRule` são declaradas nos values do Helm, versionadas junto.
- Sem cadastro, sem license key, sem custo além dos recursos do cluster que já existem.
- PromQL expressa diretamente as agregações pedidas — `histogram_quantile` para p95, `increase` para volume diário, `rate` dividido por `rate` para tempo médio por status.
- A aplicação expõe `/api/metrics` com `prom-client`; o `ServiceMonitor` descobre o alvo sozinho.

**Contra:**
- Mais componentes rodando no cluster — cerca de 1 GB de memória entre Prometheus, Grafana e Alertmanager.
- Retenção curta (6 horas, em PVC de 8 GB). Não há histórico de longo prazo.
- Se o cluster cair, o monitoramento cai junto. Um SaaS externo continuaria registrando o incidente.

## Decisão

**Prometheus + Grafana no cluster.**

O fator decisivo é **reprodutibilidade**. A entrega é avaliada por terceiros que precisam conseguir subir o ambiente a partir dos repositórios. Uma stack cujos dashboards vivem em um SaaS externo quebra essa propriedade: o avaliador veria os painéis no vídeo, mas não conseguiria recriá-los.

O segundo fator é custo. Com US$ 50 de crédito total, qualquer consumo evitável importa.

A perda de histórico longo e a dependência do próprio cluster são limitações reais, mas irrelevantes no horizonte do desafio.

## O que foi implementado

### Métricas da aplicação

Expostas em `/api/metrics` por `prom-client`, raspadas a cada 15 segundos.

| Métrica | Tipo | Alimenta |
| --- | --- | --- |
| `http_requests_total` | Counter | Throughput, taxa de erro 5xx |
| `http_request_duration_seconds` | Histogram | Latência p50 e p95 por rota |
| `oficina_ordens_servico_criadas_total` | Counter | Volume diário de OS |
| `oficina_ordens_servico_por_status` | Gauge | Distribuição por status |
| `oficina_ordem_servico_transicoes_total` | Counter | Fluxo entre status |
| `oficina_ordem_servico_duracao_status_segundos` | Histogram | Tempo médio por status |
| `oficina_ordem_servico_erros_total` | Counter | Alerta de falha no processamento |
| `oficina_integracao_falhas_total` | Counter | Erros nas integrações |

A rota é rotulada pelo **padrão** registrado no Express (`/api/clientes/:id`), não pela URL concreta, evitando explosão de cardinalidade.

O registro acontece no evento `finish` da resposta, e não no fluxo do Observable — só nesse momento o status já passou pelo exception filter, o que faz os erros serem contados como 4xx/5xx em vez de 200.

### Logs estruturados e correlação

Toda linha sai em JSON com um `correlationId`:

```json
{
  "timestamp": "2026-09-15T22:37:13.761Z",
  "nivel": "info",
  "servico": "oficina-api",
  "contexto": "OrdensServicoService",
  "correlationId": "req-abc123",
  "mensagem": "OS 42 movida para EM_EXECUCAO"
}
```

A cadeia de correlação:

1. O **API Gateway** gera um `requestId` e o registra em seu log de acesso JSON no CloudWatch.
2. Ele propaga o valor no header `x-amzn-requestid`.
3. O `CorrelacaoMiddleware` adota esse valor como `correlationId` e o guarda em `AsyncLocalStorage`, tornando-o acessível em qualquer camada sem passar o request adiante.
4. A **Lambda de autenticação** usa o mesmo `requestId` em seus logs e o devolve em `x-correlation-id`.

Uma requisição é rastreável da borda até o handler por um único identificador.

### Alertas

Oito regras cobrindo os quatro eixos exigidos — disponibilidade, desempenho, recursos e negócio. A lista completa está no README de `oficina-infra-k8s`.
