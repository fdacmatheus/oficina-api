import { Global, Module } from '@nestjs/common';
import { MetricasService } from './metricas.service';
import { MetricasController } from './metricas.controller';
import { LoggerService } from './logger.service';

/**
 * Modulo global de observabilidade: metricas Prometheus e log estruturado.
 * E global porque os services de dominio incrementam contadores de negocio.
 */
@Global()
@Module({
  controllers: [MetricasController],
  providers: [MetricasService, LoggerService],
  exports: [MetricasService, LoggerService],
})
export class ObservabilidadeModule {}
