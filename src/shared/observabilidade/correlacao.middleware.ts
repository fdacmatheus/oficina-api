import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ContextoRequisicao {
  correlationId: string;
}

// Disponibiliza o correlationId a qualquer ponto do fluxo sem precisar passar o
// request como parametro camada a camada.
export const contextoRequisicao = new AsyncLocalStorage<ContextoRequisicao>();

export function obterCorrelationId(): string | undefined {
  return contextoRequisicao.getStore()?.correlationId;
}

/**
 * Propaga o identificador de correlacao.
 *
 * O API Gateway envia o seu `requestId` no cabecalho `x-amzn-requestid`, e a
 * Lambda de autenticacao devolve o mesmo valor em `x-correlation-id`. Reutilizar
 * esse identificador permite seguir uma requisicao da borda ate o handler em uma
 * unica busca no CloudWatch.
 */
@Injectable()
export class CorrelacaoMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ??
      (req.headers['x-amzn-requestid'] as string | undefined) ??
      (req.headers['x-amzn-trace-id'] as string | undefined) ??
      randomUUID();

    res.setHeader('x-correlation-id', correlationId);

    contextoRequisicao.run({ correlationId }, () => next());
  }
}
