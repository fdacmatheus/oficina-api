# ADR-004 · Autenticação serverless com authorizer Lambda

**Status:** Aceita
**Data:** 2026-09-15

## Contexto

O enunciado exige:

- API Gateway protegendo rotas sensíveis, com autenticação **via CPF**;
- uma **Function Serverless** que valide o CPF, consulte a existência e o status do cliente na base e devolva um JWT válido.

A aplicação já tinha autenticação própria por usuário e senha (`AuthModule` com Passport e JWT), usada pelos operadores administrativos da oficina.

## Decisão

**Duas funções Lambda**, e a autenticação administrativa permanece na aplicação:

| Função | Invocação | VPC | Tamanho |
| --- | --- | --- | --- |
| `oficina-auth-token` | Só no login | Sim (precisa do RDS) | 45 KB |
| `oficina-auth-authorizer` | Toda requisição protegida | **Não** | 19 KB |

O authorizer é do tipo **`REQUEST`** do API Gateway, com `enable_simple_responses` e cache de 300 segundos.

Ambas assinam e verificam com o **mesmo segredo HS256** usado pelos guards do NestJS, publicado em `oficina/auth/jwt` no Secrets Manager.

## Justificativa

**Por que duas funções, e não uma.** O authorizer roda em **toda** requisição protegida; a emissão de token, só no login. Separá-los permite que o authorizer fique fora da VPC e sem o driver do PostgreSQL. Ficar fora da VPC elimina a criação de ENI, que é a maior fonte de latência de cold start em Lambdas com `vpc_config`. O resultado são 19 KB no caminho crítico contra 45 KB.

**Por que authorizer `REQUEST`, e não o JWT nativo.** O authorizer JWT do API Gateway exige um emissor **OIDC** com endpoint JWKS público e assinatura assimétrica. Adotá-lo significaria introduzir um Cognito User Pool ou um provedor externo — mais um componente para provisionar, e uma migração da autenticação administrativa existente. Com HS256 e segredo compartilhado, a verificação cabe em poucas linhas e o token continua compatível com o que a aplicação já emite.

**Por que o segredo é compartilhado.** O JWT emitido pela Lambda precisa ser aceito também pelos guards do NestJS quando a requisição chega ao cluster. Um segredo por componente exigiria que a aplicação validasse dois formatos de token. O segredo é gerado pelo repositório `oficina-lambda-auth`, publicado no Secrets Manager e lido pelos dois lados.

**Por que a validação de CPF está duplicada.** A regra existe em `src/shared/validators/cpf-cnpj.validator.ts` na aplicação e em `src/domain/cpf.ts` na Lambda. Importar o pacote da aplicação traria o NestJS inteiro para o bundle e inflaria o cold start de 19 KB para vários megabytes. A duplicação é o preço consciente de manter a função autocontida, e está coberta por testes nos dois lados.

## Consequências

**Positivas**

- Autenticação escala independentemente da aplicação e custa zero quando ninguém faz login.
- O cache de 300 segundos no authorizer reduz drasticamente as invocações: uma sessão ativa de 15 minutos gera no máximo 3 invocações, não uma por requisição.
- A rota `POST /auth` é a única porta de entrada da autenticação de clientes, e ela não passa pelo cluster.

**Negativas**

- **A revogação de token não é imediata.** Com cache de 5 minutos, um token revogado continua aceito até o cache expirar. Aceitável para tokens de 15 minutos; inaceitável se o sistema precisar de logout instantâneo.
- **Dois lugares para manter a regra de CPF.** Mitigado por testes em ambos, mas uma mudança na regra exige lembrar dos dois.
- **Cold start no primeiro login** após período ocioso. A função de token está na VPC e paga a criação de ENI — cerca de 1 a 2 segundos. Como só afeta o login, e não as requisições subsequentes, foi considerado aceitável.

## Segurança

- O CPF **nunca** é registrado por inteiro. A função `mascararCpf` reduz para `529.***.**25` antes de qualquer log.
- O token expira em **15 minutos**.
- As credenciais do banco e o segredo de assinatura vêm do Secrets Manager, com cache por container — nunca ficam em variável de ambiente em texto claro nem no repositório.
- A Lambda de token consulta o banco por `documento` com query parametrizada, sem concatenação de string.
