# ADR-003 · Escalabilidade horizontal com HPA

**Status:** Aceita
**Data:** 2026-09-15

## Contexto

O enunciado exige um cluster Kubernetes **com escalabilidade**. A carga da oficina é irregular: concentra-se na abertura do expediente e no fim da tarde, com vales longos no meio do dia.

Era preciso decidir a estratégia de escala, os gatilhos e os limites.

## Decisão

**Horizontal Pod Autoscaler** com gatilho duplo de CPU e memória, entre 2 e 6 réplicas:

```yaml
minReplicas: 2
maxReplicas: 6
metrics:
  - CPU: 60% de utilização média
  - memória: 75% de utilização média
behavior:
  scaleUp:   janela 30s · até 100% a mais por vez
  scaleDown: janela 180s · 1 pod por minuto
```

O node group do EKS acompanha, de 2 a 4 nodes `t3.medium`.

## Justificativa das escolhas

**`minReplicas: 2`, não 1.** Duas réplicas garantem disponibilidade durante rolling update e durante a substituição de um node. Combinado ao `PodDisruptionBudget` com `minAvailable: 1`, nenhuma operação de manutenção derruba o serviço.

**CPU a 60%.** A aplicação é I/O bound — a maior parte do tempo espera o PostgreSQL. Um gatilho mais alto (80%) atrasaria a reação, porque a CPU sobe tarde nesse perfil. 60% dá margem para o pod novo subir antes da saturação.

**Memória a 75% como segundo gatilho.** O Node acumula heap sob concorrência alta antes de a CPU reagir. Sem esse gatilho, um cenário de muitas conexões simultâneas levaria a OOMKill em vez de escala.

**Subida agressiva, descida conservadora.** `scaleUp` com janela de 30 segundos e política de 100% dobra a capacidade rapidamente no pico. `scaleDown` com janela de 180 segundos e um pod por minuto evita o efeito sanfona de um vale curto de tráfego — remover um pod que será necessário em dois minutos custa mais do que mantê-lo.

**Teto de 6 réplicas.** Com `limits` de 500m de CPU por pod, 6 réplicas cabem em 4 nodes `t3.medium`. O teto também é uma proteção de custo: sem ele, um bug de loop infinito escalaria até esgotar o crédito do laboratório. O alerta `HpaNoTeto` avisa quando o limite for atingido por 10 minutos.

## Dependências

- **metrics-server**, instalado como addon gerenciado do EKS pelo repositório `oficina-infra-k8s`. Sem ele o HPA fica em `<unknown>` e não escala.
- **`resources.requests` declarados** no container. O HPA calcula a utilização como percentual do request; sem request declarado não há denominador e o autoscaling não funciona.

## Consequências

**Positivas**

- Escala reage em ~1 minuto ao pico.
- Custo acompanha a demanda: fora do horário de pico, apenas 2 pods.
- O comportamento é observável no painel "Escalabilidade — réplicas vs. CPU" do Grafana, o que torna a demonstração em vídeo direta.

**Negativas**

- A escala reage a **sintoma** (CPU, memória), não a causa (fila de requisições). Um gargalo no banco não é resolvido por mais pods — pode até piorar, por mais conexões concorrentes.
- O `db.t3.micro` tem limite de conexões modesto. Por isso o pool do TypeORM é limitado a 10 por pod: 6 pods × 10 = 60 conexões no pior caso, dentro do que a instância suporta.

## Alternativa descartada

**KEDA com métricas customizadas** (escalar por profundidade de fila ou por requisições por segundo do Prometheus) seria tecnicamente superior — escalaria pela causa real. Foi descartado por adicionar um operador a mais para instalar, configurar e explicar, sem ganho perceptível na carga deste sistema. O HPA nativo por recursos é suficiente e é o que o enunciado pede.
