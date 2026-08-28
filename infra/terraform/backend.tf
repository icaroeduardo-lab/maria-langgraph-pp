# State remoto no MESMO bucket S3/lock do stack antigo (maria-ia-back-end),
# key própria — states independentes, sem qualquer state mv/import entre eles.
terraform {
  backend "s3" {
    bucket         = "maria-tfstate-185327115563"
    key            = "maria-langgraph-pp/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "maria-tf-lock"
    encrypt        = true
  }
}
