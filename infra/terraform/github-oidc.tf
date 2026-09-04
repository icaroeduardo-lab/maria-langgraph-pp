# Permite o GitHub Actions deste repo assumir um IAM role SEM chave fixa
# guardada como secret — token OIDC de curta duração, emitido pelo próprio
# GitHub a cada run. Decisão 2026-09-04, junto da esteira CI/CD que separa
# deploy de produção (push em main) e homolog/release (push em develop).
#
# Escopo do role é restrito ao repo + branches main/develop — só essas 2
# branches disparam deploy (ver .github/workflows/deploy-*.yml), PR de
# feature branch nunca tem permissão de assumir o role.

data "tls_certificate" "github_actions" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github_actions" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github_actions.certificates[0].sha1_fingerprint]
}

data "aws_iam_policy_document" "github_actions_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:icaroeduardo-lab/maria-langgraph-pp:ref:refs/heads/main",
        "repo:icaroeduardo-lab/maria-langgraph-pp:ref:refs/heads/develop",
      ]
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${var.project}-github-actions"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume.json
}

# Só o necessário pro pipeline: build+push de imagem no ECR deste projeto e
# forçar novo deployment nos 2 services ECS (api / api-release). NÃO inclui
# permissão de Terraform/infra — mudança de infra continua manual (ver
# comentário grande em release.tf sobre a mesma decisão pro banco/secret).
data "aws_iam_policy_document" "github_actions_deploy" {
  statement {
    sid       = "EcrAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPush"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
    ]
    resources = [aws_ecr_repository.api.arn]
  }
  statement {
    sid = "EcsDeploy"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
    ]
    resources = [
      aws_ecs_service.api.id,
      aws_ecs_service.api_release.id,
    ]
  }
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.github_actions_deploy.json
}

output "github_actions_role_arn" {
  value       = aws_iam_role.github_actions.arn
  description = "Role ARN pra configurar como variável AWS_ROLE_ARN no GitHub (Settings → Secrets and variables → Actions)."
}
