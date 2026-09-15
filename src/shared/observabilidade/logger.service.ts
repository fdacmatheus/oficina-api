import { Injectable, LoggerService as NestLoggerService, Scope } from '@nestjs/common';
import { obterCorrelationId } from './correlacao.middleware';

type Nivel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger em JSON estruturado, exigido pelo requisito de observabilidade.
 *
 * Em desenvolvimento o formato volta a ser texto legivel; em producao toda linha
 * sai como um objeto JSON com o correlationId da requisicao em curso.
 */
@Injectable({ scope: Scope.DEFAULT })
export class LoggerService implements NestLoggerService {
  private readonly json = process.env.LOG_FORMAT === 'json';
  private readonly servico = 'oficina-api';

  private emitir(nivel: Nivel, mensagem: unknown, contexto?: string, extra?: unknown): void {
    const correlationId = obterCorrelationId();

    if (!this.json) {
      const prefixo = contexto ? `[${contexto}] ` : '';
      const sufixo = correlationId ? ` (${correlationId})` : '';
      console.log(`${nivel.toUpperCase()} ${prefixo}${String(mensagem)}${sufixo}`);
      return;
    }

    const linha = JSON.stringify({
      timestamp: new Date().toISOString(),
      nivel,
      servico: this.servico,
      contexto,
      correlationId,
      mensagem: typeof mensagem === 'string' ? mensagem : JSON.stringify(mensagem),
      ...(extra ? { detalhe: extra } : {}),
    });

    if (nivel === 'error') {
      console.error(linha);
      return;
    }

    console.log(linha);
  }

  log(mensagem: unknown, contexto?: string): void {
    this.emitir('info', mensagem, contexto);
  }

  error(mensagem: unknown, trace?: string, contexto?: string): void {
    this.emitir('error', mensagem, contexto, trace);
  }

  warn(mensagem: unknown, contexto?: string): void {
    this.emitir('warn', mensagem, contexto);
  }

  debug(mensagem: unknown, contexto?: string): void {
    this.emitir('debug', mensagem, contexto);
  }

  verbose(mensagem: unknown, contexto?: string): void {
    this.emitir('debug', mensagem, contexto);
  }
}
