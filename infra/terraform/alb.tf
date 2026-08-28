resource "aws_lb" "main" {
  name               = "${var.project}-alb"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.terraform_remote_state.old.outputs.public_subnet_ids
}

resource "aws_lb_target_group" "api" {
  name        = "${var.project}-api"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = data.terraform_remote_state.old.outputs.vpc_id
  target_type = "ip" # Fargate awsvpc

  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

output "alb_dns_name" {
  value       = aws_lb.main.dns_name
  description = "DNS do ALB (apontar a Tykhe pra cá)."
}
