import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import { LoggerService } from './shared/observabilidade/logger.service';

async function bootstrap() {
  // Os logs de bootstrap ficam em buffer ate o LoggerService estar disponivel,
  // de modo que nenhuma linha escape do formato JSON estruturado.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);

  app.useLogger(app.get(LoggerService));

  // O API Gateway encaminha via VPC Link; sem confiar no proxy o Express
  // registraria o IP do load balancer no lugar do IP de origem.
  app.set('trust proxy', true);

  app.enableShutdownHooks();
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Oficina API')
    .setDescription('MVP do sistema integrado de atendimento e execução de serviços da oficina')
    .setVersion('3.0.0')
    .addBearerAuth()
    .addTag('auth', 'Autenticação — register, login e refresh de tokens JWT')
    .addTag('clientes', 'Gestão de clientes (CRUD)')
    .addTag('veiculos', 'Gestão de veículos (CRUD)')
    .addTag('servicos', 'Catálogo de serviços (CRUD)')
    .addTag('pecas', 'Gestão de peças e insumos com controle de estoque')
    .addTag('ordens-servico', 'Ordens de serviço, orçamento e fluxo de status (admin)')
    .addTag('ordens-servico-publico', 'Consulta pública de OS pelo número (sem JWT)')
    .addServer('/', 'Ambiente atual')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      persistAuthorization: true,
    },
  });

  const port = config.get<number>('PORT', 3000);

  // 0.0.0.0 e obrigatorio dentro do container: o padrao do Nest so aceitaria
  // conexoes de localhost e as probes do Kubernetes falhariam.
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
