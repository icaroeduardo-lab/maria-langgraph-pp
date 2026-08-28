# HTTPS sem domínio próprio — CloudFront na frente do ALB usa o certificado
# default *.cloudfront.net (grátis, automático, sem Route53/ACM). ALB
# continua só HTTP (tráfego CloudFront→ALB fica dentro do backbone da AWS,
# não sai pra internet pública). Mesmo padrão que o painel do back antigo
# já usava (painel.tf, removido na Fase D — só a técnica se repete aqui).
resource "aws_cloudfront_distribution" "api" {
  enabled     = true
  comment     = "HTTPS pro maria-langgraph-pp (Tykhe) — sem domínio próprio"
  price_class = "PriceClass_100" # NA + Europa (menor custo)

  origin {
    domain_name = aws_lb.main.dns_name
    origin_id   = "alb-api"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # API dinâmica, sem cache — método/headers/Authorization/query tudo
  # repassado pro ALB (managed: CachingDisabled + AllViewer).
  default_cache_behavior {
    target_origin_id         = "alb-api"
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

output "api_https_url" {
  value       = "https://${aws_cloudfront_distribution.api.domain_name}"
  description = "URL HTTPS pra passar pra Tykhe."
}
