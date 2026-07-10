# Deploy (VPS Hostinger, ao lado da v1)

1. Pré-requisito: SETUP.md concluído (.env preenchido, migração rodada, users/chats cadastrados).
2. `git clone <repo> assistente-pessoal-v2 && cd assistente-pessoal-v2`
3. Copiar o `.env` (raiz) e o `apps/web/.env` para o servidor (nunca commitar).
4. `docker compose up -d --build`
5. Logs: `docker compose logs -f assistente-v2`
6. Atualizar: `git pull && docker compose up -d --build`
7. Dashboard: http://IP_DO_VPS:8080 (ou configure um reverse proxy/domínio).
