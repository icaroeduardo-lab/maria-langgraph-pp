output "ecr_repo_url" {
  value       = aws_ecr_repository.api.repository_url
  description = "URL do repositório ECR (push da imagem antes do apply)."
}
