import { aws_ssm, NestedStack, RemovalPolicy, Stack } from "aws-cdk-lib";
import { IVpc, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Cluster } from "aws-cdk-lib/aws-ecs";
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { StackPropsWithBuildConfigAndNetworking } from "../../cdk-types";
import {
  buildEcsClusterArnSSMKey,
  buildSecurityGroupArnSSMKey,
  validateEnvVar,
} from "../../utils";
import { INSTANCE_ID } from "../../environment-variables";

const instanceId = validateEnvVar(INSTANCE_ID);

export class FargateBaseStack extends NestedStack {
  public vpc: IVpc;
  public cluster: Cluster;
  public contextId: string;
  public fargateExecutionRole: Role;
  public fargateTaskRole: Role;
  public noIngressSecurityGroup: SecurityGroup;
  public logGroup: LogGroup;

  constructor(
    scope: Construct,
    id: string,
    props: StackPropsWithBuildConfigAndNetworking,
  ) {
    super(scope, id, props);

    const { vpc, publicSubnet } = props;

    this.cluster = new Cluster(this, `fargate-cluster-${instanceId}`, {
      vpc,
    });

    this.fargateExecutionRole = new Role(
      this,
      `fargate-execution-role-${instanceId}`,
      {
        assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
        inlinePolicies: {
          taskRole: new PolicyDocument({
            statements: [
              new PolicyStatement({
                actions: [
                  "secretsmanager:GetSecretValue",
                  "secretsmanager:DescribeSecret",
                ],
                resources: ["*"],
                effect: Effect.ALLOW,
              }),
              new PolicyStatement({
                actions: [
                  "ecr:ListImages",
                  "ecr:GetAuthorizationToken",
                  "ecr:BatchCheckLayerAvailability",
                  "ecr:GetDownloadUrlForLayer",
                  "ecr:GetRepositoryPolicy",
                  "ecr:DescribeRepositories",
                  "ecr:ListImages",
                  "ecr:DescribeImages",
                  "ecr:BatchGetImage",
                  "ecr:InitiateLayerUpload",
                  "ecr:UploadLayerPart",
                  "ecr:CompleteLayerUpload",
                ],
                resources: ["*"],
                effect: Effect.ALLOW,
              }),
              new PolicyStatement({
                actions: [
                  // TODO: refine this later
                  "cloudwatch:*",
                ],
                resources: ["*"],
                effect: Effect.ALLOW,
              }),
              new PolicyStatement({
                actions: [
                  // This policy is required because otherwise cdk will generate the policies for
                  // each fargate task definition, which ends up causing some kind of broken reference.
                  // This might be a bug in cdk, not sure, but this overcomes the issue.
                  "logs:*",
                ],
                resources: ["*"],
                effect: Effect.ALLOW,
              }),
              new PolicyStatement({
                actions: [
                  // TODO: refine this later
                  "s3:Read*",
                  "s3:List*",
                  "s3:Describe*",
                  "s3:Get*",
                ],
                // Can't get the resource wildcard scoping to work
                resources: ["*"],
                effect: Effect.ALLOW,
              }),
            ],
          }),
        },
      },
    );

    this.fargateTaskRole = new Role(this, `fargate-task-role-${instanceId}`, {
      assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
      inlinePolicies: {
        taskRole: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ["sts:AssumeRole"],
              resources: ["*"],
              effect: Effect.ALLOW,
            }),
            new PolicyStatement({
              actions: [
                // TODO: refine this later
                "cloudwatch:*",
              ],
              resources: ["*"],
              effect: Effect.ALLOW,
            }),
            new PolicyStatement({
              actions: [
                // TODO: refine this later
                "ecs:*",
              ],
              resources: ["*"],
              effect: Effect.ALLOW,
            }),
            new PolicyStatement({
              actions: ["iam:PassRole"],
              resources: ["*"],
              effect: Effect.ALLOW,
            }),
            new PolicyStatement({
              actions: [
                // TODO: refine this later
                "s3:Read*",
                "s3:List*",
                "s3:Describe*",
                "s3:Get*",
              ],
              // Can't get the resource wildcard scoping to work
              resources: ["*"],
              effect: Effect.ALLOW,
            }),
            new PolicyStatement({
              actions: [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret",
              ],
              resources: ["*"],
              effect: Effect.ALLOW,
            }),
            new PolicyStatement({
              actions: ["ses:sendEmail"],
              resources: ["*"],
              effect: Effect.ALLOW,
            }),
          ],
        }),
      },
    });

    this.noIngressSecurityGroup = new SecurityGroup(
      this,
      `fargate-no-ingress-sg-${instanceId}`,
      {
        allowAllOutbound: true,
        vpc,
      },
    );

    new aws_ssm.StringParameter(this, buildEcsClusterArnSSMKey(instanceId), {
      description: "ARN of the ECS Cluster",
      parameterName: buildEcsClusterArnSSMKey(instanceId),
      stringValue: this.cluster.clusterArn,
    });

    new aws_ssm.StringParameter(this, buildSecurityGroupArnSSMKey(instanceId), {
      description: "ARN of the security group",
      parameterName: buildSecurityGroupArnSSMKey(instanceId),
      stringValue: this.noIngressSecurityGroup.securityGroupId,
    });

    const logGroupName = `fargate-${instanceId}`;
    this.logGroup = new LogGroup(this, logGroupName, {
      retention: RetentionDays.ONE_DAY,
      logGroupName,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}
