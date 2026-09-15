# RFC-002 · Escolha do banco de dados

**Status:** Resolvido — Amazon RDS for PostgreSQL 16
**Data:** 2026-09-15

## Questão

O enunciado exige um **banco de dados gerenciado** (PostgreSQL, MySQL, SQL Server ou outro) e pede justificativa formal da escolha, com ajustes no modelo relacional.

## Análise do domínio

Três características decidem a questão:

**1. Invariantes atravessam entidades.** Uma OS só é válida se o veículo pertencer ao cliente informado. Isso é uma restrição entre três tabelas, verificável pelo banco.

**2. A aprovação do orçamento é atômica.** Ela dá baixa no estoque de todas as peças da OS e muda o status. Ou tudo acontece, ou nada acontece. É uma transação ACID.

**3. As consultas de negócio são agregações.** Volume diário de OS, tempo médio por status, listagem priorizada — tudo `GROUP BY`, `AVG` e junção.

## Alternativas avaliadas

### Relacional vs. documentos

**DynamoDB / MongoDB gerenciado** foi considerado e descartado.

Modelar OS como documento único, com cliente e veículo embarcados, resolveria a leitura — mas:

- a atualização de dados do cliente exigiria varrer e reescrever todas as suas OS;
- a validação "veículo pertence ao cliente" migraria para código de aplicação, sem garantia do banco;
- a baixa de estoque de múltiplas peças perderia a atomicidade, exigindo transação distribuída ou compensação;
- as agregações dos dashboards precisariam de uma camada analítica separada.

Nada no domínio — nem volume, nem esquema variável, nem necessidade de escala horizontal do dado — justifica pagar esse custo. **Relacional.**

### PostgreSQL vs. MySQL vs. SQL Server

| Critério | PostgreSQL | MySQL | SQL Server |
| --- | --- | --- | --- |
| Tipo decimal exato | `NUMERIC` nativo | `DECIMAL` | `DECIMAL` |
| UUID nativo | Tipo `uuid` | `CHAR(36)` ou `BINARY(16)` | `UNIQUEIDENTIFIER` |
| Índice parcial | Sim | Não | Sim (filtrado) |
| Custo `db.t3.micro` | US$ 0,017/h | US$ 0,017/h | Licença inclusa, mais caro |
| Suporte TypeORM | Maduro | Maduro | Bom |
| Continuidade com Fases 1 e 2 | **Sim** | Não | Não |

**SQL Server** foi descartado pelo custo de licença, desproporcional ao projeto.

**MySQL** atenderia tecnicamente. Perde em dois pontos concretos:

- **UUID como `CHAR(36)`** desperdiça espaço e torna o índice primário maior. A aplicação gera UUIDs no domínio, então esse custo aparece em todas as chaves.
- **Sem índice parcial.** A listagem priorizada de OS se beneficia de um índice que cobre apenas as ordens visíveis (`WHERE status NOT IN (...)`). Em MySQL o índice teria de cobrir a tabela inteira.

## Decisão

**Amazon RDS for PostgreSQL 16**, instância `db.t3.micro`, storage `gp3` de 20 GB com criptografia em repouso.

Além dos critérios técnicos, pesa a **continuidade**: as Fases 1 e 2 já rodavam PostgreSQL com TypeORM, e 72 testes validam esse comportamento. Trocar de engine na fase de migração para nuvem somaria risco de regressão a um escopo já grande, sem ganho.

## Configuração adotada

| Parâmetro | Valor | Motivo |
| --- | --- | --- |
| `instance_class` | `db.t3.micro` | Free tier; suficiente para a carga do desafio |
| `allocated_storage` | 20 GB, `gp3` | Mínimo do free tier |
| `max_allocated_storage` | 40 GB | Autoscaling de storage, protege contra encher o disco |
| `storage_encrypted` | `true` | Criptografia em repouso, sem custo adicional |
| `publicly_accessible` | `false` | Sem IP público; acesso só de dentro da VPC |
| `backup_retention_period` | 1 dia | Mínimo que mantém snapshots automáticos ativos |
| `skip_final_snapshot` | `true` | Ambiente acadêmico com ciclo apply/destroy frequente |
| `performance_insights` | desativado | O Learner Lab não permite criar a role necessária |

**TLS obrigatório.** O RDS exige conexão cifrada. A aplicação usa `ssl: { rejectUnauthorized: false }` — o certificado é emitido por CA própria da AWS, e embarcar o bundle de certificados da Amazon na imagem foi considerado custo desnecessário para o contexto. Em produção real, o bundle seria montado e a verificação ativada.

**Pool limitado a 10 conexões por pod.** Com o HPA escalando até 6 réplicas, o pior caso são 60 conexões — dentro do que o `db.t3.micro` suporta.

## Ajustes no modelo relacional

Detalhados em [MODELAGEM.md](../MODELAGEM.md). Em resumo:

- **Snapshot de preço e descrição em `os_itens`**, preservando a integridade histórica do orçamento aprovado;
- **Exclusão lógica** (`ativo = false`) em `servicos` e `pecas`, já que a referência polimórfica não tem FK que bloqueie a remoção;
- **Timestamps por transição** em vez de tabela de histórico, tornando o cálculo de tempo médio por status uma subtração na mesma linha;
- **Índice parcial recomendado** para a listagem priorizada.
