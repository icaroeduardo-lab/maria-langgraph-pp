# Tokens/segredos da aplicação — valores reais preenchidos FORA do Terraform
# (aws secretsmanager put-secret-value), mesmo padrão do stack antigo.
resource "aws_secretsmanager_secret" "app" {
  name        = "${var.project}-${var.environment}/app"
  description = "Tokens/segredos do maria-langgraph-pp (Verde, DATABASE_URL, LangSmith)."
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    VERDE_API_URL     = "PREENCHER"
    VERDE_JWT_TOKEN   = "PREENCHER"
    VERDE_CLIENT_ID   = "PREENCHER"
    DATABASE_URL      = "PREENCHER" # aponta pro RDS Proxy compartilhado, banco maria_langgraph_pp
    LANGSMITH_API_KEY = "PREENCHER"
    LANGSMITH_PROJECT = "maria-langgraph-pp"
    API_KEY           = "PREENCHER" # chave que a Tykhe manda em Authorization: Bearer <API_KEY>
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

output "secret_app_arn" {
  value       = aws_secretsmanager_secret.app.arn
  description = "ARN do segredo da aplicação."
}
