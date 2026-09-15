import { Controller, Get, Header, Res } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Response } from 'express';
import { MetricasService } from './metricas.service';

@Controller('metrics')
export class MetricasController {
  constructor(private readonly metricas: MetricasService) {}

  /** Alvo do ServiceMonitor do Prometheus, raspado a cada 15 segundos. */
  @Get()
  @ApiExcludeEndpoint()
  @Header('Cache-Control', 'no-store')
  async expor(@Res() res: Response): Promise<void> {
    res.set('Content-Type', this.metricas.contentType);
    res.send(await this.metricas.expor());
  }
}
