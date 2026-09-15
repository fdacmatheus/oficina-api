# RFC-003 · Estratégia de autenticação

**Status:** Resolvido — Lambda authorizer com JWT HS256
**Data:** 2026-09-15

## Questão

O enunciado exige proteger as rotas sensíveis no **API Gateway**, com autenticação **via CPF**, e uma **function serverless** que valide o CPF, consulte o cliente na base e emita um JWT.

A aplicação já tinha autenticação por usuário e senha para os operadores administrativos. Como acomodar os dois públicos?

## Dois públicos, dois caminhos

| Público | Identificação | Rotas | Onde autentica |
| --- | --- | --- | --- |
| **Cliente** | CPF | Consulta da própria OS | Lambda serverless |
| **Operador** | usuário e senha | Gestão completa | `AuthModule` na aplicação |

Ambos os caminhos emitem um JWT com o mesmo formato de payload e o mesmo segredo, de modo que o API Gateway não precisa distinguir a origem do token.

## Alternativas avaliadas para o authorizer

### A. Authorizer JWT nativo do API Gateway

O API Gateway valida o token sozinho, sem invocar Lambda.

**A favor:** zero código, zero custo de invocação, latência mínima.

**Contra:** exige emissor **OIDC** com endpoint JWKS público e assinatura assimétrica (RS256). Adotá-lo significaria:

- introduzir um Cognito User Pool ou provedor externo;
- migrar a autenticação administrativa existente para ele;
- ou publicar um endpoint JWKS próprio, com rotação de chaves.

Descartado: o custo de introduzir um provedor de identidade inteiro supera o ganho, e o enunciado pede explicitamente uma **function serverless** de autenticação — que existiria de qualquer forma.

### B. Authorizer Lambda `TOKEN`

Tipo legado, recebe apenas o cabeçalho de autorização e retorna uma policy IAM.

**Contra:** disponível apenas em REST APIs (v1), não em HTTP APIs (v2). A HTTP API foi preferida por custo (cerca de 1/3 do preço) e por suportar VPC Link nativamente.

### C. Authorizer Lambda `REQUEST` com resposta simples — **escolhida**

Recebe o evento completo e responde `{ isAuthorized: boolean, context: {...} }`.

**A favor:**

- suportado em HTTP API;
- resposta simples dispensa montar policy IAM à mão;
- o `context` retornado chega à aplicação nos headers da integração, dispensando decodificar o token de novo no NestJS;
- `authorizer_result_ttl_in_seconds` permite cachear a decisão.

### D. Validar o JWT apenas na aplicação

Deixar o API Gateway como proxy puro e manter os guards do NestJS como única barreira.

**Contra:** requisições não autorizadas atravessariam o gateway, o VPC Link e o NLB antes de serem rejeitadas, consumindo recursos do cluster. E o enunciado exige proteção **no gateway**.

Os guards do NestJS foram **mantidos** como segunda camada — defesa em profundidade — mas não são a barreira primária.

## Decisão

**Authorizer Lambda `REQUEST`**, com:

```hcl
enable_simple_responses           = true
identity_sources                  = ["$request.header.Authorization"]
authorizer_result_ttl_in_seconds  = 300
```

Assinatura **HS256** com segredo compartilhado, publicado em `oficina/auth/jwt` no Secrets Manager.

## Análise do cache de 300 segundos

O cache é o parâmetro com maior impacto e maior risco.

**Ganho:** uma sessão de 15 minutos com uso intenso gera no máximo **3 invocações** do authorizer, em vez de uma por requisição. Reduz custo, latência e carga.

**Risco:** um token revogado continua aceito por até 5 minutos.

**Avaliação:** o token expira em 15 minutos. Uma janela de revogação de 5 minutos sobre um token de 15 é proporcional ao risco do domínio — o pior caso é um cliente consultar o status da própria OS por mais alguns minutos após um logout. Não há operação destrutiva acessível ao token de cliente.

**Quando reavaliar:** se tokens de cliente passarem a autorizar operações de escrita relevantes (pagamento, cancelamento), o TTL deve cair para 0 e a revogação passar por uma denylist consultada pelo authorizer.

## Por que HS256 e não RS256

| | HS256 | RS256 |
| --- | --- | --- |
| Chave | Simétrica, compartilhada | Par assimétrico |
| Quem pode assinar | Qualquer um que tenha o segredo | Só quem tem a privada |
| Distribuição | Segredo em todos os validadores | Pública distribuível |

RS256 é superior quando há **muitos validadores independentes** e se quer limitar quem pode emitir tokens. Aqui existem exatamente dois validadores — o authorizer e a aplicação — ambos sob o mesmo controle e ambos lendo o segredo do mesmo Secrets Manager. A vantagem do RS256 não se materializa, e HS256 é mais simples de operar.

**Consequência assumida:** qualquer componente que possa ler o segredo pode emitir tokens válidos. O acesso ao secret é a fronteira de segurança, e ele não aparece em nenhum manifesto versionado.
