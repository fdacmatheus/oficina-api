import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { MetricasService } from './metricas.service';

/**
 * Instrumenta toda requisicao HTTP com contador e histograma.
 *
 * O registro acontece no evento `finish` da resposta, e nao no fluxo do
 * Observable: so nesse momento o codigo de status ja passou pelo exception
 * filter, o que faz os erros serem contabilizados como 4xx/5xx em vez de 200.
 *
 * A rota vem do padrao registrado pelo Express (`/api/clientes/:id`) e nao da
 * URL concreta, evitando explosao de cardinalidade no Prometheus.
 */
@Injectable()
export class MetricasInterceptor implements NestInterceptor {
  constructor(private readonly metricas: MetricasService) {}

  intercept(contexto: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (contexto.getType() !== 'http') {
      return next.handle();
    }

    const http = contexto.switchToHttp();
    const req = http.getRequest<Request & { route?: { path?: string } }>();
    const res = http.getResponse<Response>();

    // O proprio endpoint de metricas nao e instrumentado.
    if (req.path?.endsWith('/metrics')) {
      return next.handle();
    }

    const finalizar = this.metricas.duracaoRequisicao.startTimer();

    res.once('finish', () => {
      const rotulos = {
        method: req.method,
        route: req.route?.path ?? req.path ?? 'desconhecida',
        status: String(res.statusCode),
      };

      this.metricas.requisicoes.inc(rotulos);
      finalizar(rotulos);
    });

    return next.handle();
  }
}
