# Rede em si (VPC/subnets/NAT) é do stack antigo (data.terraform_remote_state.old)
# — aqui só os Security Groups deste app.

resource "aws_security_group" "alb" {
  name        = "${var.project}-alb"
  description = "ALB - entrada HTTP/HTTPS da internet"
  vpc_id      = data.terraform_remote_state.old.outputs.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-alb" }
}

resource "aws_security_group" "tasks" {
  name        = "${var.project}-tasks"
  description = "Task Fargate - inbound so do ALB; egress liberado"
  vpc_id      = data.terraform_remote_state.old.outputs.vpc_id

  ingress {
    description     = "App port do ALB"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project}-tasks" }
}

# Regra standalone no SG do RDS Proxy do stack ANTIGO — dá acesso 5432 pra
# esta task SEM esse stack precisar conhecer o ID do nosso SG na hora de
# escrever o .tf dele (só na hora de aplicar, via remote state). Ver Fase B
# do plano: o SG do proxy nasce SEM ingress inline justamente pra essa regra
# ser a única fonte de acesso.
resource "aws_security_group_rule" "proxy_from_tasks" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = data.terraform_remote_state.old.outputs.rds_proxy_security_group_id
  source_security_group_id = aws_security_group.tasks.id
  description              = "maria-langgraph-pp tasks"
}
