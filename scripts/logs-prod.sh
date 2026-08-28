#!/bin/sh
# aws logs tail --follow trava/demora demais nesta versão do CLI (testado ao
# vivo — sem --follow ele é instantâneo). Poll manual: cada volta busca só a
# janela desde a última, sem repetir linha.
LAST=$(date -u -d '30 seconds ago' +%Y-%m-%dT%H:%M:%S)
while true; do
  NOW=$(date -u +%Y-%m-%dT%H:%M:%S)
  aws logs tail /ecs/maria-langgraph-pp/api --since "$LAST" --region us-east-1 2>/dev/null | sed 's/^[^{]*//' | pino-pretty
  LAST=$NOW
  sleep 3
done
