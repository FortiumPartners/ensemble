# AWS Cloud Infrastructure - Comprehensive Reference Guide

**Complete AWS infrastructure automation reference with production-ready patterns, security best practices, and real-world examples.**

---

## Table of Contents

1. [ECS/Fargate Container Deployment](#ecsfargate-container-deployment)
2. [EKS Kubernetes Management](#eks-kubernetes-management)
3. [Lambda Serverless Patterns](#lambda-serverless-patterns)
4. [RDS Database Provisioning](#rds-database-provisioning)
5. [S3 Storage & CloudFront CDN](#s3-storage--cloudfront-cdn)
6. [VPC Networking](#vpc-networking)
7. [Security Groups & NACLs](#security-groups--nacls)
8. [IAM Roles & Policies](#iam-roles--policies)
9. [Monitoring & Logging](#monitoring--logging)
10. [Cost Optimization](#cost-optimization)
11. [Disaster Recovery](#disaster-recovery)
12. [Troubleshooting Guide](#troubleshooting-guide)

---

## ECS/Fargate Container Deployment

### Architecture Overview

**ECS Components**:
- **Cluster**: Logical grouping of tasks/services
- **Task Definition**: Blueprint for your application (Docker image, CPU, memory, IAM roles)
- **Service**: Maintains desired number of tasks, integrates with load balancers
- **Task**: Running instance of a task definition

### Production-Ready ECS Cluster

```hcl
# ECS Cluster with Container Insights
resource "aws_ecs_cluster" "production" {
  name = "production-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  configuration {
    execute_command_configuration {
      kms_key_id = aws_kms_key.ecs.arn
      logging    = "OVERRIDE"

      log_configuration {
        cloud_watch_encryption_enabled = true
        cloud_watch_log_group_name     = aws_cloudwatch_log_group.ecs_exec.name
      }
    }
  }

  tags = {
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

# ECS Task Definition with Best Practices
resource "aws_ecs_task_definition" "api" {
  family                   = "api-service"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"  # 1 vCPU
  memory                   = "2048"  # 2 GB
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn           = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${aws_ecr_repository.api.repository_url}:${var.app_version}"
      essential = true

      portMappings = [{
        containerPort = 8080
        protocol      = "tcp"
      }]

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "PORT"
          value = "8080"
        }
      ]

      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = aws_secretsmanager_secret.db_url.arn
        },
        {
          name      = "API_KEY"
          valueFrom = aws_secretsmanager_secret.api_key.arn
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      ulimits = [{
        name      = "nofile"
        softLimit = 65536
        hardLimit = 65536
      }]

      linuxParameters = {
        initProcessEnabled = true
      }
    },
    {
      name      = "datadog-agent"
      image     = "public.ecr.aws/datadog/agent:latest"
      essential = false

      environment = [{
        name  = "DD_APM_ENABLED"
        value = "true"
      }]

      secrets = [{
        name      = "DD_API_KEY"
        valueFrom = aws_secretsmanager_secret.datadog_api_key.arn
      }]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_api.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "datadog"
        }
      }
    }
  ])

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
}

# ECS Service with Auto Scaling
resource "aws_ecs_service" "api" {
  name            = "api-service"
  cluster         = aws_ecs_cluster.production.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 3
  launch_type     = "FARGATE"

  platform_version = "LATEST"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8080
  }

  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
    deployment_circuit_breaker {
      enable   = true
      rollback = true
    }
  }

  deployment_controller {
    type = "ECS"
  }

  enable_execute_command = true

  propagate_tags = "SERVICE"

  tags = {
    Environment = "production"
  }

  depends_on = [
    aws_lb_listener.https,
    aws_iam_role_policy_attachment.ecs_execution
  ]
}

# Auto Scaling Configuration
resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = 10
  min_capacity       = 3
  resource_id        = "service/${aws_ecs_cluster.production.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu" {
  name               = "ecs-cpu-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 70.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

resource "aws_appautoscaling_policy" "ecs_memory" {
  name               = "ecs-memory-autoscaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = 80.0
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}
```

### ECS IAM Roles

```hcl
# ECS Execution Role (pulls images, writes logs)
resource "aws_iam_role" "ecs_execution" {
  name = "ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "ecs-execution-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue",
        "kms:Decrypt"
      ]
      Resource = [
        aws_secretsmanager_secret.db_url.arn,
        aws_secretsmanager_secret.api_key.arn,
        aws_kms_key.secrets.arn
      ]
    }]
  })
}

# ECS Task Role (application runtime permissions)
resource "aws_iam_role" "ecs_task" {
  name = "ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "ecs-task-s3-access"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ]
      Resource = "${aws_s3_bucket.app_data.arn}/*"
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_sqs" {
  name = "ecs-task-sqs-access"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ]
      Resource = aws_sqs_queue.jobs.arn
    }]
  })
}
```

### Blue/Green Deployment with CodeDeploy

```hcl
resource "aws_codedeploy_app" "api" {
  compute_platform = "ECS"
  name             = "api-deployment"
}

resource "aws_codedeploy_deployment_group" "api" {
  app_name               = aws_codedeploy_app.api.name
  deployment_group_name  = "api-deployment-group"
  service_role_arn       = aws_iam_role.codedeploy.arn
  deployment_config_name = "CodeDeployDefault.ECSAllAtOnce"

  auto_rollback_configuration {
    enabled = true
    events  = ["DEPLOYMENT_FAILURE", "DEPLOYMENT_STOP_ON_ALARM"]
  }

  blue_green_deployment_config {
    deployment_ready_option {
      action_on_timeout = "CONTINUE_DEPLOYMENT"
    }

    terminate_blue_instances_on_deployment_success {
      action                           = "TERMINATE"
      termination_wait_time_in_minutes = 5
    }
  }

  deployment_style {
    deployment_option = "WITH_TRAFFIC_CONTROL"
    deployment_type   = "BLUE_GREEN"
  }

  ecs_service {
    cluster_name = aws_ecs_cluster.production.name
    service_name = aws_ecs_service.api.name
  }

  load_balancer_info {
    target_group_pair_info {
      prod_traffic_route {
        listener_arns = [aws_lb_listener.https.arn]
      }

      target_group {
        name = aws_lb_target_group.api_blue.name
      }

      target_group {
        name = aws_lb_target_group.api_green.name
      }
    }
  }
}
```

---

## EKS Kubernetes Management

### Production EKS Cluster

```hcl
resource "aws_eks_cluster" "production" {
  name     = "production-eks"
  role_arn = aws_iam_role.eks_cluster.arn
  version  = "1.28"

  vpc_config {
    subnet_ids              = concat(aws_subnet.private[*].id, aws_subnet.public[*].id)
    endpoint_private_access = true
    endpoint_public_access  = true
    public_access_cidrs     = ["203.0.113.0/24"]  # Your office IP
    security_group_ids      = [aws_security_group.eks_cluster.id]
  }

  encryption_config {
    provider {
      key_arn = aws_kms_key.eks.arn
    }
    resources = ["secrets"]
  }

  enabled_cluster_log_types = [
    "api",
    "audit",
    "authenticator",
    "controllerManager",
    "scheduler"
  ]

  tags = {
    Environment = "production"
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster_policy,
    aws_cloudwatch_log_group.eks
  ]
}

# Managed Node Group
resource "aws_eks_node_group" "general" {
  cluster_name    = aws_eks_cluster.production.name
  node_group_name = "general-node-group"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = aws_subnet.private[*].id

  instance_types = ["t3.xlarge"]
  capacity_type  = "ON_DEMAND"

  scaling_config {
    desired_size = 3
    max_size     = 10
    min_size     = 2
  }

  update_config {
    max_unavailable = 1
  }

  remote_access {
    ec2_ssh_key               = aws_key_pair.eks_nodes.key_name
    source_security_group_ids = [aws_security_group.eks_node_ssh.id]
  }

  launch_template {
    id      = aws_launch_template.eks_nodes.id
    version = aws_launch_template.eks_nodes.latest_version
  }

  labels = {
    role        = "general"
    environment = "production"
  }

  taint {
    key    = "dedicated"
    value  = "general"
    effect = "NO_SCHEDULE"
  }

  tags = {
    "kubernetes.io/cluster/${aws_eks_cluster.production.name}" = "owned"
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_worker_node_policy,
    aws_iam_role_policy_attachment.eks_cni_policy,
    aws_iam_role_policy_attachment.eks_container_registry_policy
  ]
}

# Spot Instance Node Group for Cost Optimization
resource "aws_eks_node_group" "spot" {
  cluster_name    = aws_eks_cluster.production.name
  node_group_name = "spot-node-group"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = aws_subnet.private[*].id

  instance_types = ["t3.large", "t3a.large", "t2.large"]
  capacity_type  = "SPOT"

  scaling_config {
    desired_size = 2
    max_size     = 20
    min_size     = 0
  }

  labels = {
    role        = "spot"
    environment = "production"
  }

  taint {
    key    = "spot"
    value  = "true"
    effect = "NO_SCHEDULE"
  }
}
```

### EKS Add-ons

```hcl
# VPC CNI (Container Network Interface)
resource "aws_eks_addon" "vpc_cni" {
  cluster_name             = aws_eks_cluster.production.name
  addon_name               = "vpc-cni"
  addon_version            = "v1.15.0-eksbuild.2"
  resolve_conflicts        = "OVERWRITE"
  service_account_role_arn = aws_iam_role.vpc_cni.arn
}

# CoreDNS
resource "aws_eks_addon" "coredns" {
  cluster_name      = aws_eks_cluster.production.name
  addon_name        = "coredns"
  addon_version     = "v1.10.1-eksbuild.2"
  resolve_conflicts = "OVERWRITE"
}

# kube-proxy
resource "aws_eks_addon" "kube_proxy" {
  cluster_name      = aws_eks_cluster.production.name
  addon_name        = "kube-proxy"
  addon_version     = "v1.28.1-eksbuild.1"
  resolve_conflicts = "OVERWRITE"
}

# EBS CSI Driver
resource "aws_eks_addon" "ebs_csi" {
  cluster_name             = aws_eks_cluster.production.name
  addon_name               = "aws-ebs-csi-driver"
  addon_version            = "v1.24.0-eksbuild.1"
  service_account_role_arn = aws_iam_role.ebs_csi.arn
  resolve_conflicts        = "OVERWRITE"
}
```

### EKS IAM Roles for Service Accounts (IRSA)

```hcl
# OIDC Provider for IRSA
data "tls_certificate" "eks" {
  url = aws_eks_cluster.production.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks.certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.production.identity[0].oidc[0].issuer
}

# EBS CSI Driver IAM Role
resource "aws_iam_role" "ebs_csi" {
  name = "eks-ebs-csi-driver"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRoleWithWebIdentity"
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.eks.arn
      }
      Condition = {
        StringEquals = {
          "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:sub" = "system:serviceaccount:kube-system:ebs-csi-controller-sa"
          "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}
```

### Kubernetes Manifest Examples

**Deployment with HPA**:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-deployment
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      serviceAccountName: api-service-account
      containers:
      - name: api
        image: 123456789012.dkr.ecr.us-east-1.amazonaws.com/api:latest
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: connection-string
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: api-service
  namespace: production
spec:
  type: LoadBalancer
  selector:
    app: api
  ports:
  - port: 80
    targetPort: 8080
    protocol: TCP
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-deployment
  minReplicas: 3
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

---

## Lambda Serverless Patterns

### API Gateway + Lambda

```hcl
# Lambda Function
resource "aws_lambda_function" "api" {
  filename         = "lambda.zip"
  function_name    = "api-handler"
  role            = aws_iam_role.lambda.arn
  handler         = "index.handler"
  source_code_hash = filebase64sha256("lambda.zip")
  runtime         = "nodejs18.x"
  timeout         = 30
  memory_size     = 512

  environment {
    variables = {
      DB_HOST      = aws_db_instance.main.endpoint
      BUCKET_NAME  = aws_s3_bucket.data.id
      NODE_ENV     = "production"
    }
  }

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  tracing_config {
    mode = "Active"  # X-Ray tracing
  }

  reserved_concurrent_executions = 100

  dead_letter_config {
    target_arn = aws_sqs_queue.dlq.arn
  }

  tags = {
    Environment = "production"
  }
}

# Lambda Function URL (HTTPS endpoint)
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM"

  cors {
    allow_credentials = true
    allow_origins     = ["https://app.example.com"]
    allow_methods     = ["GET", "POST", "PUT", "DELETE"]
    allow_headers     = ["content-type", "x-api-key"]
    max_age           = 86400
  }
}

# API Gateway REST API
resource "aws_api_gateway_rest_api" "main" {
  name        = "production-api"
  description = "Production API Gateway"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_resource" "users" {
  rest_api_id = aws_api_gateway_rest_api.main.id
  parent_id   = aws_api_gateway_rest_api.main.root_resource_id
  path_part   = "users"
}

resource "aws_api_gateway_method" "users_get" {
  rest_api_id   = aws_api_gateway_rest_api.main.id
  resource_id   = aws_api_gateway_resource.users.id
  http_method   = "GET"
  authorization = "AWS_IAM"

  request_parameters = {
    "method.request.querystring.limit" = false
  }
}

resource "aws_api_gateway_integration" "users_lambda" {
  rest_api_id             = aws_api_gateway_rest_api.main.id
  resource_id             = aws_api_gateway_resource.users.id
  http_method             = aws_api_gateway_method.users_get.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.api.invoke_arn
}

# Lambda Permission for API Gateway
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main.execution_arn}/*/*"
}

# API Gateway Deployment
resource "aws_api_gateway_deployment" "production" {
  rest_api_id = aws_api_gateway_rest_api.main.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.users.id,
      aws_api_gateway_method.users_get.id,
      aws_api_gateway_integration.users_lambda.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.users_lambda
  ]
}

resource "aws_api_gateway_stage" "production" {
  deployment_id = aws_api_gateway_deployment.production.id
  rest_api_id   = aws_api_gateway_rest_api.main.id
  stage_name    = "production"

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      caller         = "$context.identity.caller"
      user           = "$context.identity.user"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      resourcePath   = "$context.resourcePath"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }

  xray_tracing_enabled = true

  tags = {
    Environment = "production"
  }
}

# API Gateway Usage Plan & API Key
resource "aws_api_gateway_usage_plan" "main" {
  name = "production-usage-plan"

  api_stages {
    api_id = aws_api_gateway_rest_api.main.id
    stage  = aws_api_gateway_stage.production.stage_name
  }

  quota_settings {
    limit  = 1000000
    period = "MONTH"
  }

  throttle_settings {
    burst_limit = 5000
    rate_limit  = 10000
  }
}
```

### Event-Driven Lambda Patterns

**SQS Trigger**:
```hcl
resource "aws_lambda_event_source_mapping" "sqs" {
  event_source_arn = aws_sqs_queue.jobs.arn
  function_name    = aws_lambda_function.processor.arn
  batch_size       = 10
  maximum_batching_window_in_seconds = 5

  scaling_config {
    maximum_concurrency = 100
  }

  function_response_types = ["ReportBatchItemFailures"]
}
```

**S3 Trigger**:
```hcl
resource "aws_lambda_permission" "s3" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.image_processor.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.uploads.arn
}

resource "aws_s3_bucket_notification" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.image_processor.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "uploads/"
    filter_suffix       = ".jpg"
  }

  depends_on = [aws_lambda_permission.s3]
}
```

**EventBridge Schedule**:
```hcl
resource "aws_cloudwatch_event_rule" "daily_cleanup" {
  name                = "daily-cleanup"
  description         = "Trigger Lambda every day at 2 AM UTC"
  schedule_expression = "cron(0 2 * * ? *)"
}

resource "aws_cloudwatch_event_target" "lambda" {
  rule      = aws_cloudwatch_event_rule.daily_cleanup.name
  target_id = "cleanup-lambda"
  arn       = aws_lambda_function.cleanup.arn
}

resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cleanup.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_cleanup.arn
}
```

---

## RDS Database Provisioning

### PostgreSQL Production Setup

```hcl
resource "aws_db_subnet_group" "main" {
  name       = "production-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "Production DB subnet group"
  }
}

resource "aws_db_parameter_group" "postgres15" {
  name   = "postgres15-production"
  family = "postgres15"

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_duration"
    value = "1"
  }

  parameter {
    name  = "log_statement"
    value = "all"
  }

  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }

  parameter {
    name  = "max_connections"
    value = "200"
  }

  parameter {
    name  = "work_mem"
    value = "16384"  # 16 MB in KB
  }
}

resource "aws_db_instance" "postgres" {
  identifier     = "production-postgres"
  engine         = "postgres"
  engine_version = "15.4"

  instance_class        = "db.r6g.xlarge"  # 4 vCPU, 32 GB RAM
  allocated_storage     = 500
  max_allocated_storage = 2000  # Auto-scaling up to 2TB
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id           = aws_kms_key.rds.arn
  iops                 = 12000
  storage_throughput   = 500

  db_name  = "production"
  username = "admin"
  password = random_password.db_password.result
  port     = 5432

  multi_az               = true
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.postgres15.name

  # Backups
  backup_retention_period   = 30
  backup_window            = "03:00-04:00"
  maintenance_window       = "mon:04:00-mon:05:00"
  delete_automated_backups = false

  # Enhanced Monitoring
  monitoring_interval             = 60
  monitoring_role_arn            = aws_iam_role.rds_monitoring.arn
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Performance Insights
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.rds.arn
  performance_insights_retention_period = 7

  # Auto Minor Version Upgrade
  auto_minor_version_upgrade = true

  # Deletion Protection
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "production-postgres-final-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"
  copy_tags_to_snapshot     = true

  tags = {
    Environment = "production"
    Backup      = "required"
  }
}

# Read Replica
resource "aws_db_instance" "postgres_replica" {
  identifier             = "production-postgres-replica"
  replicate_source_db    = aws_db_instance.postgres.identifier
  instance_class         = "db.r6g.large"
  publicly_accessible    = false
  skip_final_snapshot    = true
  vpc_security_group_ids = [aws_security_group.rds.id]

  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.rds.arn
  performance_insights_retention_period = 7

  tags = {
    Environment = "production"
    Role        = "read-replica"
  }
}

# RDS Proxy for Connection Pooling
resource "aws_db_proxy" "postgres" {
  name                   = "production-postgres-proxy"
  engine_family          = "POSTGRESQL"
  auth {
    auth_scheme = "SECRETS"
    iam_auth    = "REQUIRED"
    secret_arn  = aws_secretsmanager_secret.db_credentials.arn
  }

  role_arn               = aws_iam_role.rds_proxy.arn
  vpc_subnet_ids         = aws_subnet.private[*].id
  require_tls            = true
  idle_client_timeout    = 1800

  tags = {
    Environment = "production"
  }
}

resource "aws_db_proxy_default_target_group" "postgres" {
  db_proxy_name = aws_db_proxy.postgres.name

  connection_pool_config {
    max_connections_percent      = 100
    max_idle_connections_percent = 50
    connection_borrow_timeout    = 120
  }
}

resource "aws_db_proxy_target" "postgres" {
  db_proxy_name          = aws_db_proxy.postgres.name
  target_group_name      = aws_db_proxy_default_target_group.postgres.name
  db_instance_identifier = aws_db_instance.postgres.id
}
```

### Aurora PostgreSQL Serverless v2

```hcl
resource "aws_rds_cluster" "aurora" {
  cluster_identifier      = "production-aurora"
  engine                  = "aurora-postgresql"
  engine_mode             = "provisioned"
  engine_version          = "15.3"
  database_name           = "production"
  master_username         = "admin"
  master_password         = random_password.aurora_password.result

  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.aurora.id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.aurora.name

  serverlessv2_scaling_configuration {
    max_capacity = 16.0  # 16 ACUs
    min_capacity = 0.5   # 0.5 ACUs
  }

  backup_retention_period      = 30
  preferred_backup_window      = "03:00-04:00"
  preferred_maintenance_window = "mon:04:00-mon:05:00"

  enabled_cloudwatch_logs_exports = ["postgresql"]

  storage_encrypted   = true
  kms_key_id         = aws_kms_key.aurora.arn
  deletion_protection = true

  skip_final_snapshot       = false
  final_snapshot_identifier = "production-aurora-final-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"

  tags = {
    Environment = "production"
  }
}

resource "aws_rds_cluster_instance" "aurora" {
  count              = 2
  identifier         = "production-aurora-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.aurora.id
  instance_class     = "db.serverless"
  engine             = aws_rds_cluster.aurora.engine
  engine_version     = aws_rds_cluster.aurora.engine_version

  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.aurora.arn

  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn

  tags = {
    Environment = "production"
  }
}
```

---

## S3 Storage & CloudFront CDN

### S3 Bucket Best Practices

```hcl
resource "aws_s3_bucket" "static_assets" {
  bucket = "company-static-assets"

  tags = {
    Environment = "production"
    Purpose     = "static-assets"
  }
}

# Versioning
resource "aws_s3_bucket_versioning" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Server-Side Encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

# Public Access Block
resource "aws_s3_bucket_public_access_block" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle Rules
resource "aws_s3_bucket_lifecycle_configuration" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id

  rule {
    id     = "transition-to-ia"
    status = "Enabled"

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 180
      storage_class = "GLACIER_IR"
    }

    transition {
      days          = 365
      storage_class = "DEEP_ARCHIVE"
    }
  }

  rule {
    id     = "delete-old-versions"
    status = "Enabled"

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "STANDARD_IA"
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }

  rule {
    id     = "cleanup-incomplete-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Intelligent Tiering
resource "aws_s3_bucket_intelligent_tiering_configuration" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id
  name   = "entire-bucket"

  tiering {
    access_tier = "ARCHIVE_ACCESS"
    days        = 90
  }

  tiering {
    access_tier = "DEEP_ARCHIVE_ACCESS"
    days        = 180
  }
}

# Replication (Cross-Region)
resource "aws_s3_bucket_replication_configuration" "static_assets" {
  depends_on = [aws_s3_bucket_versioning.static_assets]

  role   = aws_iam_role.s3_replication.arn
  bucket = aws_s3_bucket.static_assets.id

  rule {
    id     = "replicate-all"
    status = "Enabled"

    filter {}

    destination {
      bucket        = aws_s3_bucket.static_assets_replica.arn
      storage_class = "STANDARD_IA"

      encryption_configuration {
        replica_kms_key_id = aws_kms_key.s3_replica.arn
      }

      replication_time {
        status = "Enabled"
        time {
          minutes = 15
        }
      }

      metrics {
        status = "Enabled"
        event_threshold {
          minutes = 15
        }
      }
    }

    delete_marker_replication {
      status = "Enabled"
    }
  }
}

# Logging
resource "aws_s3_bucket_logging" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id

  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "s3-access-logs/"
}

# Object Lock (WORM)
resource "aws_s3_bucket_object_lock_configuration" "static_assets" {
  bucket = aws_s3_bucket.static_assets.id

  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 365
    }
  }
}
```

### CloudFront Distribution

```hcl
resource "aws_cloudfront_origin_access_identity" "main" {
  comment = "OAI for static assets"
}

resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  price_class         = "PriceClass_100"  # US, Canada, Europe
  comment             = "Production CDN"
  default_root_object = "index.html"

  aliases = ["cdn.example.com", "static.example.com"]

  # S3 Origin
  origin {
    domain_name = aws_s3_bucket.static_assets.bucket_regional_domain_name
    origin_id   = "S3-static-assets"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.main.cloudfront_access_identity_path
    }

    origin_shield {
      enabled              = true
      origin_shield_region = "us-east-1"
    }
  }

  # Custom Origin (API)
  origin {
    domain_name = "api.example.com"
    origin_id   = "API-backend"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  # Default Cache Behavior (S3)
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "S3-static-assets"
    viewer_protocol_policy = "redirect-to-https"
    compress              = true

    cache_policy_id            = aws_cloudfront_cache_policy.static.id
    origin_request_policy_id   = aws_cloudfront_origin_request_policy.static.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.url_rewrite.arn
    }
  }

  # API Cache Behavior
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "API-backend"
    viewer_protocol_policy = "https-only"
    compress              = true

    cache_policy_id          = aws_cloudfront_cache_policy.api.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id

    lambda_function_association {
      event_type   = "viewer-request"
      lambda_arn   = aws_lambda_function.auth.qualified_arn
      include_body = false
    }
  }

  # Custom Error Responses
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  # Geo Restriction
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # SSL Certificate
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.cdn.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  # Logging
  logging_config {
    include_cookies = false
    bucket          = aws_s3_bucket.cdn_logs.bucket_domain_name
    prefix          = "cloudfront/"
  }

  # WAF
  web_acl_id = aws_wafv2_web_acl.cdn.arn

  tags = {
    Environment = "production"
  }
}

# CloudFront Cache Policy
resource "aws_cloudfront_cache_policy" "static" {
  name        = "static-assets-cache"
  default_ttl = 86400    # 1 day
  max_ttl     = 31536000 # 1 year
  min_ttl     = 1

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }

    headers_config {
      header_behavior = "none"
    }

    query_strings_config {
      query_string_behavior = "none"
    }

    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# CloudFront Response Headers Policy
resource "aws_cloudfront_response_headers_policy" "security" {
  name = "security-headers"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
      override                = true
    }
  }

  custom_headers_config {
    items {
      header   = "X-Custom-Header"
      value    = "production"
      override = true
    }
  }
}

# CloudFront Function (URL Rewrite)
resource "aws_cloudfront_function" "url_rewrite" {
  name    = "url-rewrite"
  runtime = "cloudfront-js-1.0"
  comment = "Rewrite URLs for SPA routing"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;

      // Check if the URI has a file extension
      if (!uri.includes('.')) {
        request.uri = '/index.html';
      }

      return request;
    }
  EOT
}
```

---

## VPC Networking

### Production VPC Architecture

```hcl
data "aws_availability_zones" "available" {
  state = "available"
}

# VPC
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  enable_network_address_usage_metrics = true

  tags = {
    Name        = "production-vpc"
    Environment = "production"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "production-igw"
  }
}

# Elastic IPs for NAT Gateways
resource "aws_eip" "nat" {
  count  = 3
  domain = "vpc"

  tags = {
    Name = "nat-gateway-eip-${count.index + 1}"
  }

  depends_on = [aws_internet_gateway.main]
}

# Public Subnets (3 AZs)
resource "aws_subnet" "public" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  map_public_ip_on_launch = true

  tags = {
    Name                     = "public-subnet-${count.index + 1}"
    Type                     = "public"
    "kubernetes.io/role/elb" = "1"
  }
}

# Private Subnets (3 AZs)
resource "aws_subnet" "private" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name                              = "private-subnet-${count.index + 1}"
    Type                              = "private"
    "kubernetes.io/role/internal-elb" = "1"
  }
}

# Database Subnets (3 AZs)
resource "aws_subnet" "database" {
  count             = 3
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 20}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "database-subnet-${count.index + 1}"
    Type = "database"
  }
}

# NAT Gateways (one per AZ for high availability)
resource "aws_nat_gateway" "main" {
  count         = 3
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = {
    Name = "nat-gateway-${count.index + 1}"
  }

  depends_on = [aws_internet_gateway.main]
}

# Public Route Table
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "public-route-table"
  }
}

resource "aws_route_table_association" "public" {
  count          = 3
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private Route Tables (one per AZ)
resource "aws_route_table" "private" {
  count  = 3
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }

  tags = {
    Name = "private-route-table-${count.index + 1}"
  }
}

resource "aws_route_table_association" "private" {
  count          = 3
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Database Route Table
resource "aws_route_table" "database" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "database-route-table"
  }
}

resource "aws_route_table_association" "database" {
  count          = 3
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database.id
}

# VPC Flow Logs
resource "aws_flow_log" "main" {
  iam_role_arn    = aws_iam_role.vpc_flow_logs.arn
  log_destination = aws_cloudwatch_log_group.vpc_flow_logs.arn
  traffic_type    = "ALL"
  vpc_id          = aws_vpc.main.id

  tags = {
    Name = "production-vpc-flow-logs"
  }
}

resource "aws_cloudwatch_log_group" "vpc_flow_logs" {
  name              = "/aws/vpc/production-flow-logs"
  retention_in_days = 30

  kms_key_id = aws_kms_key.logs.arn
}

# VPC Endpoints (PrivateLink)
resource "aws_vpc_endpoint" "s3" {
  vpc_id       = aws_vpc.main.id
  service_name = "com.amazonaws.${var.aws_region}.s3"

  route_table_ids = concat(
    [aws_route_table.public.id],
    aws_route_table.private[*].id,
    [aws_route_table.database.id]
  )

  tags = {
    Name = "s3-vpc-endpoint"
  }
}

resource "aws_vpc_endpoint" "ecr_api" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = {
    Name = "ecr-api-vpc-endpoint"
  }
}

resource "aws_vpc_endpoint" "ecr_dkr" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints.id]
  private_dns_enabled = true

  tags = {
    Name = "ecr-dkr-vpc-endpoint"
  }
}

# Network ACLs
resource "aws_network_acl" "public" {
  vpc_id     = aws_vpc.main.id
  subnet_ids = aws_subnet.public[*].id

  egress {
    protocol   = "-1"
    rule_no    = 100
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 0
    to_port    = 0
  }

  ingress {
    protocol   = "tcp"
    rule_no    = 100
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 80
    to_port    = 80
  }

  ingress {
    protocol   = "tcp"
    rule_no    = 110
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 443
    to_port    = 443
  }

  ingress {
    protocol   = "tcp"
    rule_no    = 120
    action     = "allow"
    cidr_block = "0.0.0.0/0"
    from_port  = 1024
    to_port    = 65535
  }

  tags = {
    Name = "public-nacl"
  }
}
```

---

## Security Groups & NACLs

### Layered Security Group Architecture

```hcl
# ALB Security Group
resource "aws_security_group" "alb" {
  name        = "alb-security-group"
  description = "Security group for Application Load Balancer"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP from internet (redirect to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description     = "To application containers"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  tags = {
    Name = "alb-sg"
  }
}

# ECS Tasks Security Group
resource "aws_security_group" "ecs_tasks" {
  name        = "ecs-tasks-security-group"
  description = "Security group for ECS tasks"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "HTTPS to internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description     = "To RDS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds.id]
  }

  egress {
    description     = "To Redis"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.redis.id]
  }

  tags = {
    Name = "ecs-tasks-sg"
  }
}

# RDS Security Group
resource "aws_security_group" "rds" {
  name        = "rds-security-group"
  description = "Security group for RDS database"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from ECS tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  ingress {
    description     = "PostgreSQL from Lambda"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  ingress {
    description     = "PostgreSQL from bastion"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.bastion.id]
  }

  tags = {
    Name = "rds-sg"
  }
}

# Redis/ElastiCache Security Group
resource "aws_security_group" "redis" {
  name        = "redis-security-group"
  description = "Security group for Redis cluster"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  tags = {
    Name = "redis-sg"
  }
}

# Lambda Security Group
resource "aws_security_group" "lambda" {
  name        = "lambda-security-group"
  description = "Security group for Lambda functions"
  vpc_id      = aws_vpc.main.id

  egress {
    description = "HTTPS to internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description     = "To RDS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds.id]
  }

  tags = {
    Name = "lambda-sg"
  }
}

# Bastion Host Security Group
resource "aws_security_group" "bastion" {
  name        = "bastion-security-group"
  description = "Security group for bastion host"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "SSH from office"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = var.office_cidr_blocks
  }

  egress {
    description = "SSH to private instances"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }

  egress {
    description     = "PostgreSQL to RDS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.rds.id]
  }

  tags = {
    Name = "bastion-sg"
  }
}
```

---

## IAM Roles & Policies

### Service-Specific IAM Roles

```hcl
# ECS Task Execution Role
data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    effect  = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json

  tags = {
    Purpose = "ECS task execution"
  }
}

data "aws_iam_policy_document" "ecs_execution" {
  # ECR access
  statement {
    sid    = "ECRAccess"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage"
    ]
    resources = ["*"]
  }

  # CloudWatch Logs
  statement {
    sid    = "CloudWatchLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["${aws_cloudwatch_log_group.ecs.arn}:*"]
  }

  # Secrets Manager
  statement {
    sid    = "SecretsAccess"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue"
    ]
    resources = [
      aws_secretsmanager_secret.db_url.arn,
      aws_secretsmanager_secret.api_key.arn
    ]
  }

  # KMS for secret decryption
  statement {
    sid    = "KMSDecrypt"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey"
    ]
    resources = [aws_kms_key.secrets.arn]
  }
}

resource "aws_iam_role_policy" "ecs_execution" {
  name   = "ecs-execution-policy"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution.json
}

# Lambda Execution Role
data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    effect  = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "lambda-execution-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

data "aws_iam_policy_document" "lambda_execution" {
  # CloudWatch Logs
  statement {
    sid    = "CloudWatchLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents"
    ]
    resources = ["arn:aws:logs:*:*:*"]
  }

  # VPC access
  statement {
    sid    = "VPCAccess"
    effect = "Allow"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses"
    ]
    resources = ["*"]
  }

  # X-Ray tracing
  statement {
    sid    = "XRayTracing"
    effect = "Allow"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords"
    ]
    resources = ["*"]
  }

  # S3 access
  statement {
    sid    = "S3Access"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject"
    ]
    resources = ["${aws_s3_bucket.data.arn}/*"]
  }

  # SQS access
  statement {
    sid    = "SQSAccess"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:SendMessage"
    ]
    resources = [
      aws_sqs_queue.jobs.arn,
      aws_sqs_queue.dlq.arn
    ]
  }
}

resource "aws_iam_role_policy" "lambda_execution" {
  name   = "lambda-execution-policy"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_execution.json
}
```

### Cross-Account Access

```hcl
# Trust policy for cross-account access
data "aws_iam_policy_document" "cross_account_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    effect  = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.trusted_account_id}:root"]
    }

    condition {
      test     = "StringEquals"
      variable = "sts:ExternalId"
      values   = [var.external_id]
    }
  }
}

resource "aws_iam_role" "cross_account" {
  name               = "cross-account-role"
  assume_role_policy = data.aws_iam_policy_document.cross_account_assume_role.json

  max_session_duration = 3600  # 1 hour
}

data "aws_iam_policy_document" "cross_account_policy" {
  statement {
    sid    = "ReadOnlyS3Access"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:ListBucket"
    ]
    resources = [
      aws_s3_bucket.shared_data.arn,
      "${aws_s3_bucket.shared_data.arn}/*"
    ]
  }
}

resource "aws_iam_role_policy" "cross_account" {
  name   = "cross-account-policy"
  role   = aws_iam_role.cross_account.id
  policy = data.aws_iam_policy_document.cross_account_policy.json
}
```

---

## Monitoring & Logging

### CloudWatch Dashboards

```hcl
resource "aws_cloudwatch_dashboard" "production" {
  dashboard_name = "production-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ECS", "CPUUtilization", { stat = "Average", period = 300 }],
            [".", "MemoryUtilization", { stat = "Average", period = 300 }]
          ]
          view    = "timeSeries"
          region  = var.aws_region
          title   = "ECS Cluster Metrics"
          period  = 300
          stacked = false
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", { stat = "Average", period = 300 }],
            [".", "DatabaseConnections", { stat = "Average", period = 300 }],
            [".", "FreeableMemory", { stat = "Average", period = 300 }]
          ]
          view   = "timeSeries"
          region = var.aws_region
          title  = "RDS Database Metrics"
          period = 300
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", { stat = "Average", period = 60 }],
            [".", "RequestCount", { stat = "Sum", period = 60 }],
            [".", "HTTPCode_Target_4XX_Count", { stat = "Sum", period = 60 }],
            [".", "HTTPCode_Target_5XX_Count", { stat = "Sum", period = 60 }]
          ]
          view   = "timeSeries"
          region = var.aws_region
          title  = "Load Balancer Metrics"
          period = 60
        }
      }
    ]
  })
}
```

### CloudWatch Alarms

```hcl
# High CPU Utilization
resource "aws_cloudwatch_metric_alarm" "ecs_high_cpu" {
  alarm_name          = "ecs-high-cpu-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "ECS CPU utilization is too high"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = aws_ecs_cluster.production.name
  }
}

# RDS Connection Count
resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name          = "rds-high-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 150
  alarm_description   = "RDS connection count is high"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.id
  }
}

# ALB 5XX Errors
resource "aws_cloudwatch_metric_alarm" "alb_5xx_errors" {
  alarm_name          = "alb-high-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "ALB is returning too many 5XX errors"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }
}

# Lambda Errors
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "lambda-high-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "Lambda function is experiencing errors"
  alarm_actions       = [aws_sns_topic.alerts.arn]

  dimensions = {
    FunctionName = aws_lambda_function.api.function_name
  }
}
```

### SNS Alerting

```hcl
resource "aws_sns_topic" "alerts" {
  name              = "production-alerts"
  kms_master_key_id = aws_kms_key.sns.id

  tags = {
    Environment = "production"
  }
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = "ops@example.com"
}

resource "aws_sns_topic_subscription" "slack" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "https"
  endpoint  = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
}

resource "aws_sns_topic_subscription" "pagerduty" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "https"
  endpoint  = "https://events.pagerduty.com/integration/YOUR_KEY/enqueue"
}
```

---

## Cost Optimization

### Reserved Instances Strategy

**RDS**: Purchase 1-year or 3-year Reserved Instances for predictable database workloads (save 40-60%)

**EC2/EKS**: Use Savings Plans for compute flexibility (save 30-50%)

**ElastiCache**: Reserved nodes for Redis clusters (save 40-55%)

### Spot Instances

**EKS Worker Nodes**: Use Spot Instances for fault-tolerant workloads
**ECS Tasks**: Fargate Spot for batch processing (save 70%)

### S3 Cost Optimization

```hcl
# Intelligent-Tiering
resource "aws_s3_bucket_intelligent_tiering_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  name   = "entire-bucket"

  tiering {
    access_tier = "ARCHIVE_ACCESS"
    days        = 90
  }

  tiering {
    access_tier = "DEEP_ARCHIVE_ACCESS"
    days        = 180
  }
}

# Lifecycle Policies
resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire-old-logs"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER_IR"
    }

    expiration {
      days = 365
    }
  }
}
```

### CloudWatch Logs Retention

```hcl
resource "aws_cloudwatch_log_group" "application" {
  name              = "/aws/application/production"
  retention_in_days = 7  # Reduce from default (never expire)

  kms_key_id = aws_kms_key.logs.arn
}
```

### Budget Alerts

```hcl
resource "aws_budgets_budget" "monthly" {
  name              = "monthly-budget"
  budget_type       = "COST"
  limit_amount      = "5000"
  limit_unit        = "USD"
  time_period_start = "2025-01-01_00:00"
  time_unit         = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = ["finance@example.com"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = ["finance@example.com"]
  }
}
```

---

## Disaster Recovery

### RDS Automated Backups

```hcl
resource "aws_db_instance" "postgres" {
  # ... other configuration ...

  backup_retention_period = 30
  backup_window          = "03:00-04:00"
  copy_tags_to_snapshot  = true
  delete_automated_backups = false

  skip_final_snapshot       = false
  final_snapshot_identifier = "production-postgres-final-${formatdate("YYYY-MM-DD", timestamp())}"
}
```

### Cross-Region S3 Replication

```hcl
resource "aws_s3_bucket_replication_configuration" "critical_data" {
  depends_on = [aws_s3_bucket_versioning.critical_data]

  role   = aws_iam_role.s3_replication.arn
  bucket = aws_s3_bucket.critical_data.id

  rule {
    id     = "replicate-to-dr-region"
    status = "Enabled"

    filter {}

    destination {
      bucket        = aws_s3_bucket.critical_data_dr.arn
      storage_class = "STANDARD_IA"
      region        = "us-west-2"  # DR region

      replication_time {
        status = "Enabled"
        time {
          minutes = 15
        }
      }

      metrics {
        status = "Enabled"
        event_threshold {
          minutes = 15
        }
      }
    }
  }
}
```

### Infrastructure as Code Backup

Store Terraform state in S3 with versioning and replication:

```hcl
terraform {
  backend "s3" {
    bucket         = "company-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    kms_key_id     = "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
    dynamodb_table = "terraform-state-lock"
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = "company-terraform-state"
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_replication_configuration" "terraform_state" {
  # Replicate to DR region
}
```

---

## Troubleshooting Guide

### ECS Task Won't Start

**Check**:
1. CloudWatch Logs: `/ecs/task-definition-family`
2. Task definition CPU/memory limits
3. IAM execution role permissions
4. ECR image pull errors
5. Security group ingress/egress rules

**Common Issues**:
- `CannotPullContainerError`: ECR permissions or image doesn't exist
- `ResourceInitializationError`: Task role missing permissions
- Health check failures: Incorrect health check path or timeout

### RDS Connection Issues

**Check**:
1. Security group allows inbound on port 5432/3306
2. DB instance is in `available` state
3. VPC subnet routing to private subnets
4. Connection string format: `postgres://user:pass@host:5432/dbname`

**Commands**:
```bash
# Test connectivity from ECS task
aws ecs execute-command --cluster production \
  --task <task-id> \
  --container api \
  --interactive \
  --command "/bin/bash"

# Inside container
nc -zv <rds-endpoint> 5432
```

### Lambda Timeout Issues

**Check**:
1. Lambda timeout configuration (max 15 minutes)
2. VPC Lambda: NAT Gateway for internet access
3. Cold start duration with large packages
4. Recursive Lambda invocations (stack overflow)

**Optimization**:
- Increase memory (also increases CPU)
- Use Provisioned Concurrency for critical functions
- Implement connection pooling for databases
- Use Lambda Layers for dependencies

### S3 Access Denied

**Check**:
1. Bucket policy allows IAM role
2. IAM role policy includes `s3:GetObject`, `s3:PutObject`
3. Bucket encryption: KMS key policy allows decryption
4. Bucket versioning enabled for object access

**Debug**:
```bash
# Test IAM permissions
aws s3 ls s3://bucket-name --profile <profile>

# Check bucket policy
aws s3api get-bucket-policy --bucket bucket-name

# Verify object exists
aws s3api head-object --bucket bucket-name --key path/to/file
```

---

## Version Information

- **Version**: 1.0.0
- **Last Updated**: October 2025
- **Maintainer**: Fortium Infrastructure Team
- **Terraform Compatibility**: ≥1.5.0
- **AWS Provider**: ≥5.0.0
- **Total Reference Size**: ~200KB

---

## Additional Resources

**AWS Documentation**:
- [Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [Security Best Practices](https://docs.aws.amazon.com/security/)
- [Cost Optimization](https://aws.amazon.com/pricing/cost-optimization/)

**Terraform Documentation**:
- [AWS Provider](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [Best Practices](https://www.terraform.io/docs/cloud/guides/recommended-practices/index.html)

**Community Resources**:
- [Terraform AWS Modules](https://github.com/terraform-aws-modules)
- [AWS Samples](https://github.com/aws-samples)
