import { Injectable, OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Registro central das metricas expostas em `/api/metrics`.
 *
 * Os nomes seguem a convencao do Prometheus e correspondem exatamente as
 * queries dos dashboards versionados no repositorio oficina-infra-k8s.
 */
@Injectable()
export class MetricasService implements OnModuleInit {
  readonly registry = new Registry();

  /** Requisicoes HTTP por metodo, rota e codigo de status. */
  readonly requisicoes = new Counter({
    name: 'http_requests_total',
    help: 'Total de requisicoes HTTP',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  /** Latencia das requisicoes, base dos percentis p50 e p95. */
  readonly duracaoRequisicao = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duracao das requisicoes HTTP em segundos',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  /** Ordens de servico abertas, alimenta o painel de volume diario. */
  readonly ordensCriadas = new Counter({
    name: 'oficina_ordens_servico_criadas_total',
    help: 'Total de ordens de servico abertas',
    registers: [this.registry],
  });

  /** Quantidade atual de ordens em cada status. */
  readonly ordensPorStatus = new Gauge({
    name: 'oficina_ordens_servico_por_status',
    help: 'Quantidade de ordens de servico por status',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  /** Transicoes de status, usada para acompanhar o fluxo da OS. */
  readonly transicoes = new Counter({
    name: 'oficina_ordem_servico_transicoes_total',
    help: 'Transicoes de status das ordens de servico',
    labelNames: ['de', 'para'] as const,
    registers: [this.registry],
  });

  /** Tempo que uma OS permaneceu em cada status antes de avancar. */
  readonly duracaoStatus = new Histogram({
    name: 'oficina_ordem_servico_duracao_status_segundos',
    help: 'Tempo de permanencia da ordem de servico em cada status',
    labelNames: ['status'] as const,
    buckets: [60, 300, 900, 1800, 3600, 7200, 21600, 86400],
    registers: [this.registry],
  });

  /** Erros no processamento de OS, dispara o alerta critico. */
  readonly errosOrdemServico = new Counter({
    name: 'oficina_ordem_servico_erros_total',
    help: 'Falhas no processamento de ordens de servico',
    labelNames: ['operacao'] as const,
    registers: [this.registry],
  });

  /** Falhas nas integracoes externas: e-mail e webhook de orcamento. */
  readonly falhasIntegracao = new Counter({
    name: 'oficina_integracao_falhas_total',
    help: 'Falhas nas integracoes externas',
    labelNames: ['integracao'] as const,
    registers: [this.registry],
  });

  onModuleInit(): void {
    // Metricas de processo do Node: heap, event loop, GC e handles abertos.
    collectDefaultMetrics({ register: this.registry, prefix: 'oficina_' });
  }

  async expor(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
