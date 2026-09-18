# Grafana OSS pra observabilidade (issue #79) — imagem oficial
# grafana/grafana-oss, sem build próprio (não precisa de repositório ECR).
# Reaproveita cluster/ALB/VPC/RDS já existentes (mesmo racional de
# release.tf) — só duplica o que precisa ficar ISOLADO: secret, task/service
# ECS, security group próprio, task role próprio (CloudWatch READ-ONLY,
# nunca a mesma role da app), target group, listener rule, CloudFront.
#
# Persistência: banco Postgres novo ("grafana") dentro da MESMA instância
# RDS que a app já usa (maria-chat-prod-pg, via o mesmo RDS Proxy) —
# decisão de 2026-09-17 (não usar o RDS "db-dashboards" separado que
# também existe na conta). Sem isso, Grafana usaria SQLite efêmero
# (Fargate não tem disco persistente) e perderia dashboards/usuários a
# cada redeploy. O banco em si ("CREATE DATABASE grafana") não é
# gerenciado por este Terraform — nenhum provider de Postgres neste stack
# — criado 1x via o mesmo mecanismo de ecs run-task já usado pra outras
# tarefas administrativas no banco (ver histórico de sessão).
#
# Roteamento: mesmo padrão de release.tf — sem domínio próprio, CloudFront
# injeta um header (X-Maria-App: grafana) que o ALB usa pra rotear pro
# target group certo. MESMO ALB dos outros ambientes, só mais um listener
# rule — não expõe rota nova pra internet além da distribuição CloudFront
# própria.

# ── Secret ───────────────────────────────────────────────────────────────
# Valores reais preenchidos FORA do Terraform (aws secretsmanager
# put-secret-value), mesmo padrão de secrets.tf/release.tf. DATABASE_URL
# aqui reaproveita a MESMA credencial Postgres da app (usuário "maria",
# já com acesso à instância inteira via o proxy) — só troca o NOME DO
# BANCO na connection string (banco "grafana", isolado por database, não
# por usuário). GF_SECURITY_ADMIN_* é o login inicial do próprio Grafana
# (distinto de qualquer credencial da app).
resource "aws_secretsmanager_secret" "grafana" {
  name        = "${var.project}-grafana/app"
  description = "Credenciais do Grafana (admin inicial + Postgres do backend dele) — observabilidade, issue #79."
}

resource "aws_secretsmanager_secret_version" "grafana" {
  secret_id = aws_secretsmanager_secret.grafana.id
  secret_string = jsonencode({
    GF_SECURITY_ADMIN_USER     = "PREENCHER"
    GF_SECURITY_ADMIN_PASSWORD = "PREENCHER"
    GF_DATABASE_URL            = "PREENCHER" # postgres://usuario:senha@host:5432/grafana — MESMO host/proxy da app, banco "grafana"
    # Issue #81 — credenciais SMTP do SES (derivadas da access key do
    # usuário aws_iam_user.grafana_ses abaixo, algoritmo de conversão da
    # AWS — não é a secret access key crua). GF_SMTP_FROM_ADDRESS precisa
    # ser um e-mail VERIFICADO no SES (sandbox mode) — mesmo endereço
    # usado como destinatário funciona (verificado 2026-09-18).
    GF_SMTP_USER         = "PREENCHER"
    GF_SMTP_PASSWORD     = "PREENCHER"
    GF_SMTP_FROM_ADDRESS = "icaro.eduardo@defensoria.rj.def.br"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── Secret — usuário Postgres SOMENTE LEITURA pro datasource (issue #83) ──
# NUNCA o usuário "maria" da app (esse tem INSERT/UPDATE/DELETE) — role
# própria, read-only, criada manualmente (mesmo racional do "CREATE
# DATABASE grafana" acima: sem provider de Postgres neste stack). Rodar 1x
# via psql/ecs run-task, no banco maria_langgraph_pp (prod) e
# maria_langgraph_pp_release:
#   CREATE ROLE grafana_readonly WITH LOGIN PASSWORD '<gerar senha forte>';
#   GRANT CONNECT ON DATABASE maria_langgraph_pp TO grafana_readonly;
#   GRANT USAGE ON SCHEMA public TO grafana_readonly;
#   GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_readonly;
#   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana_readonly;
#   -- repetir GRANT CONNECT/USAGE/SELECT trocando o banco pra maria_langgraph_pp_release
# Depois preencher este secret (aws secretsmanager put-secret-value) e criar
# o datasource Postgres no Grafana (UI ou API /api/datasources) apontando
# pro mesmo host/proxy da app, usuário/senha abaixo.
resource "aws_secretsmanager_secret" "grafana_postgres_readonly" {
  name        = "${var.project}-grafana/postgres-readonly"
  description = "Usuário Postgres somente-leitura pro datasource Postgres do Grafana (dados de negócio, issue #83) — nunca o usuário da app."
}

resource "aws_secretsmanager_secret_version" "grafana_postgres_readonly" {
  secret_id = aws_secretsmanager_secret.grafana_postgres_readonly.id
  secret_string = jsonencode({
    PGUSER     = "PREENCHER" # grafana_readonly
    PGPASSWORD = "PREENCHER"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ── IAM — task role PRÓPRIA, só leitura no CloudWatch ─────────────────────
resource "aws_iam_role" "grafana_task" {
  name               = "${var.project}-grafana-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "grafana_task" {
  statement {
    sid = "CloudWatchMetricsReadOnly"
    actions = [
      "cloudwatch:GetMetricData",
      "cloudwatch:GetMetricStatistics",
      "cloudwatch:ListMetrics",
      "cloudwatch:DescribeAlarms",
      "cloudwatch:DescribeAlarmsForMetric",
    ]
    resources = ["*"]
  }
  statement {
    sid = "CloudWatchLogsReadOnly"
    actions = [
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
      "logs:StartQuery",
      "logs:StopQuery",
      "logs:GetQueryResults",
      "logs:GetLogRecord",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "grafana_task" {
  name   = "cloudwatch-read-only"
  role   = aws_iam_role.grafana_task.id
  policy = data.aws_iam_policy_document.grafana_task.json
}

# Execution role é COMPARTILHADA com os outros ambientes (iam.tf) — só
# precisa saber ler ESTE secret também, é isso que puxa as env vars pro
# container no start. Reaproveitar (em vez de criar outra execution role)
# é seguro: execution role só faz pull de imagem + logs + leitura de
# secret, nunca chamadas de negócio em runtime (isso é o task role, que
# aqui É separado).
resource "aws_iam_role_policy" "exec_secrets_grafana" {
  name = "read-secrets-grafana"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = aws_secretsmanager_secret.grafana.arn
    }]
  })
}

# ── SES — usuário dedicado só pra mandar e-mail de alerta (issue #81) ─────
# Sending autorizado só pro endereço verificado abaixo (SES em sandbox
# mode, 2026-09-18) — produção de verdade (mandar pra qualquer endereço)
# precisaria sair do sandbox (pedido formal à AWS), fora de escopo agora.
resource "aws_iam_user" "grafana_ses" {
  name = "${var.project}-grafana-ses"
}

data "aws_iam_policy_document" "grafana_ses" {
  statement {
    actions   = ["ses:SendRawEmail", "ses:SendEmail"]
    resources = ["*"]
  }
}

resource "aws_iam_user_policy" "grafana_ses" {
  name   = "send-email"
  user   = aws_iam_user.grafana_ses.name
  policy = data.aws_iam_policy_document.grafana_ses.json
}

resource "aws_iam_access_key" "grafana_ses" {
  user = aws_iam_user.grafana_ses.name
}

output "grafana_ses_access_key_id" {
  value       = aws_iam_access_key.grafana_ses.id
  description = "Access key do usuário SES do Grafana — GF_SMTP_USER é este valor, sem conversão."
}

output "grafana_ses_secret_access_key" {
  value       = aws_iam_access_key.grafana_ses.secret
  description = "Secret access key — usar só pra derivar a senha SMTP (algoritmo SigV4 da AWS), nunca colocar essa crua no secret do Grafana."
  sensitive   = true
}

# ── Security Group — próprio, ingress só do ALB, egress liberado ─────────
resource "aws_security_group" "grafana_tasks" {
  name        = "${var.project}-grafana-tasks"
  description = "Task Fargate do Grafana - inbound so do ALB; egress liberado"
  vpc_id      = data.terraform_remote_state.old.outputs.vpc_id

  ingress {
    description     = "Grafana port do ALB"
    from_port       = var.grafana_container_port
    to_port         = var.grafana_container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-grafana-tasks" }
}

# Mesmo padrão de proxy_from_tasks (network.tf) — dá acesso 5432 ao RDS
# Proxy compartilhado pra ESTE security group novo, sem o stack antigo
# precisar conhecer o ID na hora de escrever o .tf dele.
resource "aws_security_group_rule" "proxy_from_grafana" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = data.terraform_remote_state.old.outputs.rds_proxy_security_group_id
  source_security_group_id = aws_security_group.grafana_tasks.id
  description              = "maria-langgraph-pp grafana"
}

# ── ECS (task + service) ───────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "grafana" {
  name              = "/ecs/${var.project}/grafana"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "grafana" {
  family                   = "${var.project}-grafana"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.grafana_cpu
  memory                   = var.grafana_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.grafana_task.arn

  container_definitions = jsonencode([{
    name = "grafana"
    # Versão testada manualmente (local, 2026-09-17) antes de subir aqui —
    # pinada de propósito, "latest" arriscaria upgrade surpresa num redeploy.
    image        = "grafana/grafana-oss:13.0.2"
    essential    = true
    portMappings = [{ containerPort = var.grafana_container_port, protocol = "tcp" }]
    environment = [
      { name = "GF_SERVER_HTTP_PORT", value = tostring(var.grafana_container_port) },
      { name = "GF_DATABASE_TYPE", value = "postgres" },
      { name = "AWS_REGION", value = var.aws_region },
      # Issue #81 — alerta por e-mail via SMTP do SES. Host/porta não são
      # segredo (fixo pela região), só usuário/senha/from ficam no secret.
      { name = "GF_SMTP_ENABLED", value = "true" },
      { name = "GF_SMTP_HOST", value = "email-smtp.${var.aws_region}.amazonaws.com:587" },
    ]
    secrets = [
      for k in ["GF_SECURITY_ADMIN_USER", "GF_SECURITY_ADMIN_PASSWORD", "GF_DATABASE_URL", "GF_SMTP_USER", "GF_SMTP_PASSWORD", "GF_SMTP_FROM_ADDRESS"] :
      { name = k, valueFrom = "${aws_secretsmanager_secret.grafana.arn}:${k}::" }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.grafana.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "grafana"
      }
    }
  }])
}

resource "aws_lb_target_group" "grafana" {
  name        = "${var.project}-grafana"
  port        = var.grafana_container_port
  protocol    = "HTTP"
  vpc_id      = data.terraform_remote_state.old.outputs.vpc_id
  target_type = "ip"

  health_check {
    path                = "/api/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_ecs_service" "grafana" {
  name            = "grafana"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.grafana.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = data.terraform_remote_state.old.outputs.private_subnet_ids
    security_groups  = [aws_security_group.grafana_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.grafana.arn
    container_name   = "grafana"
    container_port   = var.grafana_container_port
  }

  depends_on = [aws_lb_listener.http, aws_security_group_rule.proxy_from_grafana]

  lifecycle {
    ignore_changes = [desired_count]
  }
}

# ── Roteamento: regra no MESMO listener do ALB, por header ────────────────
resource "aws_lb_listener_rule" "grafana" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.grafana.arn
  }

  condition {
    http_header {
      http_header_name = "X-Maria-App"
      values           = ["grafana"]
    }
  }
}

# ── CloudFront própria (injeta o header acima em toda request) ────────────
resource "aws_cloudfront_distribution" "grafana" {
  enabled     = true
  comment     = "HTTPS pro Grafana (observabilidade, issue #79)"
  price_class = "PriceClass_100"

  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "alb-grafana"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
    custom_header {
      name  = "X-Maria-App"
      value = "grafana"
    }
  }

  default_cache_behavior {
    target_origin_id         = "alb-grafana"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # AllViewer
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

output "grafana_https_url" {
  value       = "https://${aws_cloudfront_distribution.grafana.domain_name}"
  description = "URL HTTPS do Grafana — login em GF_SECURITY_ADMIN_USER/PASSWORD (secret grafana)."
}
