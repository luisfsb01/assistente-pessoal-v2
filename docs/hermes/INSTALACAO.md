# Conectar o Hermes ao Assistente Pessoal V2 — passo a passo

Este guia foi escrito para quem não tem familiaridade com servidor. Faça uma etapa por vez e só avance depois da verificação indicada.

O Hermes tem um bot próprio no Telegram. Ele acessará o Assistente Pessoal V2 por uma conexão MCP protegida. O V2 continuará responsável por gravar, reler e confirmar os dados financeiros.

## Situação atual

- [x] Hermes instalado na VPS.
- [x] Bot novo do Telegram configurado no Hermes.
- [x] Migração `0014_hermes_operations.sql` executada no Supabase.
- [ ] Código da integração enviado ao GitHub.
- [ ] Assistente V2 atualizado na VPS.
- [ ] Chave secreta configurada nos dois serviços.
- [ ] MCP e skill configurados no Hermes.
- [ ] Teste completo pelo Telegram realizado.

> Importante: no momento em que este guia foi atualizado, o código da integração ainda estava somente no computador local. Antes de executar o deploy abaixo, é necessário fazer o commit e o push para o GitHub.

## Antes de começar

Você precisará de:

1. Acesso ao terminal da VPS, pelo painel da Hostinger.
2. Aproximadamente 20 minutos.
3. Um local seguro para guardar temporariamente uma chave de 64 caracteres. Pode ser seu gerenciador de senhas. Não envie essa chave pelo Telegram nem nesta conversa.

Nos comandos abaixo:

- Digite ou cole uma linha por vez.
- Pressione `Enter` depois de cada linha.
- Não copie o símbolo `$` quando ele aparecer em exemplos de outros sites. Neste guia, os blocos já contêm somente o comando.
- Se aparecer um erro, não continue às cegas. Consulte a seção “Problemas comuns”.

## Etapa 1 — Abrir o terminal e localizar o V2

1. Entre no painel da Hostinger.
2. Abra sua VPS.
3. Abra o terminal pelo navegador.
4. Cole:

   ```bash
   whoami
   ```

   É normal aparecer `root`.

5. Agora entre na pasta do Assistente V2:

   ```bash
   cd /root/assistente-pessoal-v2
   ```

6. Confira se está na pasta certa:

   ```bash
   pwd
   ```

   O resultado esperado é:

   ```text
   /root/assistente-pessoal-v2
   ```

7. Confira se os arquivos existem:

   ```bash
   ls
   ```

   Você deve encontrar nomes como `apps`, `docker-stack.yml`, `package.json` e `scripts`.

Se o comando `cd` disser que a pasta não existe, pare e veja “A pasta do V2 não foi encontrada”.

## Etapa 2 — Confirmar que o código chegou ao GitHub

Esta etapa só pode ser feita depois do push da integração.

Dentro da pasta `/root/assistente-pessoal-v2`, execute:

```bash
git fetch origin master
git log -1 --oneline origin/master
```

O commit mais recente deverá mencionar a integração com Hermes ou MCP. Se não mencionar, não faça o deploy ainda: o código provavelmente ainda não foi enviado ao GitHub.

## Etapa 3 — Gerar a chave da conexão

1. Gere uma chave secreta:

   ```bash
   openssl rand -hex 32
   ```

2. O terminal mostrará uma linha parecida com esta, mas com outros caracteres:

   ```text
   3e79a1...linha-com-64-caracteres...cf02
   ```

3. Copie a linha inteira.
4. Guarde-a temporariamente em um local seguro. Ela será usada duas vezes:
   - uma no Assistente V2;
   - outra no Hermes.

Não gere duas chaves diferentes. Os dois lados precisam usar exatamente a mesma chave.

## Etapa 4 — Colocar a chave no Assistente V2

1. Confirme que continua na pasta correta:

   ```bash
   cd /root/assistente-pessoal-v2
   ```

2. Faça uma cópia de segurança do arquivo de configurações:

   ```bash
   cp .env .env.backup-antes-hermes
   ```

3. Veja se alguém já criou essa configuração anteriormente:

   ```bash
   grep -n '^HERMES_MCP_TOKEN=' .env
   ```

   - Se não aparecer nada, você criará a linha no final do arquivo.
   - Se aparecer uma linha, edite essa linha; não crie outra com o mesmo nome.

4. Abra o arquivo:

   ```bash
   nano .env
   ```

5. Use a seta para baixo até chegar ao final do arquivo ou até a linha que já existe.
6. Crie ou atualize a linha com este formato, substituindo o texto pela chave que você guardou:

   ```dotenv
   HERMES_MCP_TOKEN=COLE_AQUI_A_CHAVE_DE_64_CARACTERES
   ```

   Não coloque espaços antes ou depois do sinal `=`. Não use aspas.

7. Salve no `nano`:
   - pressione `Ctrl + O`;
   - pressione `Enter` para confirmar o nome;
   - pressione `Ctrl + X` para sair.

8. Verifique sem mostrar a chave na tela:

   ```bash
   grep -q '^HERMES_MCP_TOKEN=.{64}$' .env && echo 'CHAVE DO V2: OK' || echo 'CHAVE DO V2: VERIFICAR'
   ```

O resultado precisa ser:

```text
CHAVE DO V2: OK
```

Se aparecer `VERIFICAR`, abra novamente com `nano .env` e confira se a linha tem a chave completa, sem espaços e sem aspas.

## Etapa 5 — Atualizar e reiniciar o Assistente V2

O script abaixo baixa o código mais recente, constrói a aplicação e reinicia apenas o serviço do Assistente V2:

```bash
FORCE=1 bash scripts/deploy-pull.sh
```

Esse comando pode levar alguns minutos e normalmente não mostra o progresso na tela porque grava o resultado em um arquivo de log.

Quando o comando terminar, veja o final do log:

```bash
tail -n 40 /root/apv2-deploy.log
```

Procure pela expressão:

```text
deploy OK
```

Depois confira o serviço:

```bash
docker service ps assistente-v2_assistente-v2
```

Na coluna de estado, o esperado é algo semelhante a `Running`.

Por fim, teste a aplicação:

```bash
curl -sS https://assistente.aiexcelencia.com/health
```

O resultado esperado é:

```json
{"ok":true}
```

## Etapa 6 — Confirmar que a rota MCP está protegida

Execute:

```bash
curl -i -X POST https://assistente.aiexcelencia.com/mcp
```

O esperado é aparecer `401 Unauthorized`. Isso é bom: significa que a rota existe e recusou uma chamada sem a chave.

Interpretação:

- `401 Unauthorized`: correto, pode continuar.
- `404 Not Found`: o código novo ainda não entrou no ar.
- `502 Bad Gateway`: o serviço V2 não iniciou corretamente.
- Uma página HTML: o domínio ou o roteamento precisa ser conferido.

## Etapa 7 — Descobrir em qual usuário o Hermes está instalado

Ainda no terminal, execute:

```bash
echo $HOME
hermes gateway status
```

Depois confira a pasta do Hermes:

```bash
ls -la ~/.hermes
```

Você deve encontrar arquivos ou pastas como `config.yaml`, `.env`, `skills` e `logs`.

> Atenção: execute todas as próximas etapas com o mesmo usuário que executa `hermes gateway status`. Caso o Hermes tenha sido instalado em outro usuário, `~/.hermes` apontará para a pasta errada.

## Etapa 8 — Colocar a mesma chave no Hermes

1. Faça uma cópia de segurança, se o arquivo já existir:

   ```bash
   cp ~/.hermes/.env ~/.hermes/.env.backup-antes-v2
   ```

   Se aparecer que o arquivo não existe, não há problema; prossiga.

2. Veja se a configuração já existe:

   ```bash
   grep -n '^ASSISTENTE_V2_MCP_TOKEN=' ~/.hermes/.env 2>/dev/null
   ```

   Se aparecer uma linha, edite-a em vez de criar outra.

3. Abra o arquivo:

   ```bash
   nano ~/.hermes/.env
   ```

4. Vá até o final e crie ou atualize a linha abaixo usando exatamente a mesma chave da Etapa 3:

   ```dotenv
   ASSISTENTE_V2_MCP_TOKEN=COLE_AQUI_A_MESMA_CHAVE_DE_64_CARACTERES
   ```

5. Salve com `Ctrl + O`, pressione `Enter` e saia com `Ctrl + X`.
6. Verifique sem exibir a chave:

   ```bash
   grep -q '^ASSISTENTE_V2_MCP_TOKEN=.{64}$' ~/.hermes/.env && echo 'CHAVE DO HERMES: OK' || echo 'CHAVE DO HERMES: VERIFICAR'
   ```

O resultado precisa ser `CHAVE DO HERMES: OK`.

## Etapa 9 — Acrescentar a conexão MCP ao Hermes

1. Primeiro faça uma cópia de segurança:

   ```bash
   cp ~/.hermes/config.yaml ~/.hermes/config.yaml.backup-antes-v2
   ```

2. Verifique se o arquivo já possui uma seção chamada `mcp_servers`:

   ```bash
   grep -n '^mcp_servers:' ~/.hermes/config.yaml
   ```

3. Abra o arquivo:

   ```bash
   nano ~/.hermes/config.yaml
   ```

### Caso A — o comando `grep` não mostrou nada

Vá até o final do arquivo e cole o bloco completo:

```yaml
mcp_servers:
  assistente_v2:
    url: "https://assistente.aiexcelencia.com/mcp"
    headers:
      Authorization: "Bearer ${ASSISTENTE_V2_MCP_TOKEN}"
    enabled: true
    timeout: 60
    connect_timeout: 15
    supports_parallel_tool_calls: false
    trust: full
    tools:
      include:
        - finance_list_categories
        - finance_list_transactions
        - finance_get_transaction
        - finance_confirm_transaction
        - finance_reclassify_transaction
        - finance_sync_bank
        - operations_list_receipts
        - habit_list_pending
        - habit_record_checkin
        - task_list_due
        - task_record_reminder_answer
        - project_list_overdue_tasks
        - project_update_task
        - travel_delete_list
        - travel_create_trip
        - travel_list_trips
        - travel_get_summary
        - travel_update_trip
        - travel_add_reservation
        - travel_import_gmail
        - knowledge_save_content
        - knowledge_save_url
        - knowledge_search
      resources: false
      prompts: false
```

### Caso B — o comando `grep` mostrou uma linha `mcp_servers:`

Não crie outra linha `mcp_servers:`. Localize a seção que já existe e acrescente dentro dela somente este bloco, mantendo os dois espaços antes de `assistente_v2`:

```yaml
  assistente_v2:
    url: "https://assistente.aiexcelencia.com/mcp"
    headers:
      Authorization: "Bearer ${ASSISTENTE_V2_MCP_TOKEN}"
    enabled: true
    timeout: 60
    connect_timeout: 15
    supports_parallel_tool_calls: false
    trust: full
    tools:
      include:
        - finance_list_categories
        - finance_list_transactions
        - finance_get_transaction
        - finance_confirm_transaction
        - finance_reclassify_transaction
        - finance_sync_bank
        - operations_list_receipts
        - habit_list_pending
        - habit_record_checkin
        - task_list_due
        - task_record_reminder_answer
        - project_list_overdue_tasks
        - project_update_task
        - travel_delete_list
        - travel_create_trip
        - travel_list_trips
        - travel_get_summary
        - travel_update_trip
        - travel_add_reservation
        - travel_import_gmail
        - knowledge_save_content
        - knowledge_save_url
        - knowledge_search
      resources: false
      prompts: false
```

No `nano`, salve com `Ctrl + O`, pressione `Enter` e saia com `Ctrl + X`.

Agora valide o arquivo:

```bash
hermes config check
```

Se aparecer um erro de YAML, não reinicie o Hermes. Restaure o backup:

```bash
cp ~/.hermes/config.yaml.backup-antes-v2 ~/.hermes/config.yaml
```

Nesse caso, peça ajuda informando apenas a mensagem do erro — nunca envie a chave.

## Etapa 10 — Instalar as instruções de segurança da integração

A skill ensina o Hermes a conferir a gravação no banco antes de afirmar sucesso.

Execute:

```bash
mkdir -p ~/.hermes/skills/assistente-pessoal-v2
cp /root/assistente-pessoal-v2/docs/hermes/skills/assistente-pessoal-v2/SKILL.md ~/.hermes/skills/assistente-pessoal-v2/SKILL.md
```

Confira:

```bash
ls -l ~/.hermes/skills/assistente-pessoal-v2/SKILL.md
```

O arquivo `SKILL.md` deve aparecer na tela.

Se o repositório não estiver em `/root/assistente-pessoal-v2`, adapte somente a primeira parte do caminho de origem.

## Etapa 11 — Reiniciar o Hermes

Execute:

```bash
hermes gateway restart
```

Aguarde aproximadamente 10 segundos e confira:

```bash
hermes gateway status
```

O status deve indicar que o gateway está em execução.

Se o comando `restart` disser que não existe serviço instalado, use `/reload-mcp` diretamente na conversa com o bot do Hermes. Se você iniciou o gateway manualmente, encerre o processo e execute novamente `hermes gateway run` pelo mesmo método usado na instalação.

## Etapa 12 — Validar pelo Telegram do Hermes

Abra a conversa com o bot novo do Hermes e envie uma mensagem por vez, nesta ordem.

### Teste 1 — ferramentas

```text
Quais ferramentas do Assistente Pessoal V2 estão disponíveis?
```

O Hermes deve mencionar ferramentas financeiras ou nomes iniciados por `mcp_assistente_v2_`.

### Teste 2 — categorias

```text
Use o Assistente V2 e liste minhas categorias financeiras.
```

Ele deve devolver categorias existentes no seu sistema.

### Teste 3 — consulta sem alteração

```text
Use o Assistente V2 e mostre as últimas cinco transações pendentes de revisão. Não altere nada.
```

Confira se os valores parecem reais.

### Teste 4 — reclassificação controlada

Escolha uma transação não sensível da lista e envie, substituindo o código e a categoria:

```text
Reclassifique a transação A045 como Compras Necessárias. Depois releia o banco e só diga que concluiu se estiver confirmada.
```

O retorno correto deve indicar:

- `status` igual a `succeeded`;
- `verified` igual a `true`;
- `verified_at` preenchido;
- `operation_id` preenchido;
- situação da transação igual a `confirmed`.

### Teste 5 — simular a reclamação original

Depois do teste anterior, envie:

```text
Confira no Assistente V2 se a classificação que acabei de pedir foi realmente salva no banco.
```

O Hermes deve consultar novamente e informar o estado real. Ele não deve apenas responder “sim” com base na conversa.

## Etapa 13 — Conferir se os dois bots continuam funcionando

1. Envie uma consulta simples ao bot antigo do Assistente V2.
2. Envie outra consulta ao bot novo do Hermes.
3. Os dois devem responder normalmente porque usam tokens diferentes do Telegram.

Durante o piloto, não desligue o bot antigo. Primeiro use o Hermes por alguns dias e confira os resultados.

## Problemas comuns

### A pasta do V2 não foi encontrada

Execute:

```bash
find /root -maxdepth 3 -type d -name 'assistente-pessoal-v2' 2>/dev/null
```

Use o caminho retornado no lugar de `/root/assistente-pessoal-v2`.

### O deploy não mostrou nada

O script grava em arquivo. Consulte:

```bash
tail -n 80 /root/apv2-deploy.log
```

### A rota `/mcp` retorna 404

O código da integração ainda não foi implantado. Confira:

```bash
cd /root/assistente-pessoal-v2
git log -1 --oneline
```

Depois refaça a Etapa 5 quando o commit correto estiver no GitHub.

### O Hermes mostra erro 401

As chaves provavelmente são diferentes ou um dos serviços não foi reiniciado.

1. Não mostre as chaves na tela.
2. Abra os dois arquivos e recoloque a mesma chave:
   - `/root/assistente-pessoal-v2/.env`;
   - `~/.hermes/.env`.
3. Refaça o deploy do V2 e reinicie o Hermes.

### O Hermes não mostra as ferramentas

1. Envie `/reload-mcp` ao bot do Hermes.
2. Se não resolver, execute:

   ```bash
   hermes gateway restart
   hermes gateway status
   ```

3. Confira os logs recentes:

   ```bash
   hermes logs --follow --level INFO
   ```

   Pressione `Ctrl + C` para parar de acompanhar os logs.

### O Hermes não inicia depois de editar o YAML

Restaure a configuração anterior:

```bash
cp ~/.hermes/config.yaml.backup-antes-v2 ~/.hermes/config.yaml
hermes gateway restart
```

### O V2 não inicia depois de editar o `.env`

Restaure a configuração anterior:

```bash
cd /root/assistente-pessoal-v2
cp .env.backup-antes-hermes .env
FORCE=1 bash scripts/deploy-pull.sh
```

## Como desligar somente a integração

Para desativar temporariamente sem afetar o bot antigo:

1. Abra:

   ```bash
   nano ~/.hermes/config.yaml
   ```

2. No bloco `assistente_v2`, troque:

   ```yaml
   enabled: true
   ```

   por:

   ```yaml
   enabled: false
   ```

3. Salve e execute:

   ```bash
   hermes gateway restart
   ```

Os recibos já existentes continuarão salvos no Supabase para auditoria.
