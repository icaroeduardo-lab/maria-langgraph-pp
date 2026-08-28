# Lê a VPC/subnets/RDS Proxy do stack antigo (maria-ia-back-end) — infra de
# rede+dados compartilhada, continua gerenciada por AQUELE state. Este stack
# nunca escreve nele, só lê outputs. `rds_proxy_security_group_id` é um
# output NOVO (ver Fase B do plano) — sem ele, o plan deste stack falha até
# o trim do stack antigo ser aplicado.
data "terraform_remote_state" "old" {
  backend = "s3"
  config = {
    bucket = var.old_state_bucket
    key    = var.old_state_key
    region = var.aws_region
  }
}
