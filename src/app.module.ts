import { join } from 'node:path';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { ClientesModule } from './modules/clientes/clientes.module';
import { OrdensServicoModule } from './modules/ordens-servico/ordens-servico.module';
import { PecasModule } from './modules/pecas/pecas.module';
import { ServicosModule } from './modules/servicos/servicos.module';
import { VeiculosModule } from './modules/veiculos/veiculos.module';
import { SeedModule } from './shared/database/seed.module';
import { HealthController } from './shared/health/health.controller';
import { ObservabilidadeModule } from './shared/observabilidade/observabilidade.module';
import { MetricasInterceptor } from './shared/observabilidade/metricas.interceptor';
import { CorrelacaoMiddleware } from './shared/observabilidade/correlacao.middleware';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ObservabilidadeModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USER', 'oficina'),
        password: config.get<string>('DB_PASSWORD', 'oficina'),
        database: config.get<string>('DB_NAME', 'oficina'),
        autoLoadEntities: true,
        synchronize: config.get<string>('DB_SYNCHRONIZE', 'false') === 'true',

        // O schema e criado por migration, nunca por sincronizacao automatica.
        // Como o Deployment sobe varias replicas ao mesmo tempo, o TypeORM
        // serializa a execucao pela tabela de controle: a primeira replica
        // aplica, as demais encontram tudo aplicado.
        migrations: [join(__dirname, 'shared/database/migrations/*.{js,ts}')],
        migrationsRun: config.get<string>('DB_MIGRATIONS_RUN', 'true') === 'true',

        // O RDS exige TLS. O certificado e emitido por uma CA propria da AWS,
        // entao a verificacao da cadeia fica desativada em vez de embarcar o
        // bundle de certificados da Amazon na imagem.
        ssl: config.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,

        // Em um ambiente com HPA, varios pods sobem ao mesmo tempo; um pool
        // enxuto por pod evita esgotar o limite de conexoes do db.t3.micro.
        extra: { max: 10 },

        retryAttempts: 10,
        retryDelay: 3000,
      }),
    }),
    AuthModule,
    ClientesModule,
    VeiculosModule,
    ServicosModule,
    PecasModule,
    OrdensServicoModule,
    SeedModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: MetricasInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelacaoMiddleware).forRoutes('*');
  }
}
