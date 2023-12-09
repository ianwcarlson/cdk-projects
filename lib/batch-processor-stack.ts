import * as cdk from "aws-cdk-lib";
import {
  CfnNatGateway,
  IpAddresses,
  PrivateSubnet,
  PublicSubnet,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import {
  buildEcsClusterArnSSMKey,
  buildSecurityGroupArnSSMKey,
  validateEnvVar,
} from "../utils";
import { ACCOUNT, INSTANCE_ID, REGION } from "../environment-variables";
import { FargateBaseStack } from "./ecs/fargate-base";
import { Cluster } from "aws-cdk-lib/aws-ecs";
import {
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { FargateStack } from "./ecs/fargate";

const region = validateEnvVar(REGION);
const account = validateEnvVar(ACCOUNT);
const instanceId = validateEnvVar(INSTANCE_ID);

export class BatchProcessorStack extends cdk.Stack {
  publicSubnet: PublicSubnet;
  privateSubnet: PrivateSubnet;
  natGateway: CfnNatGateway;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, `batch-processor-${instanceId}`, {
      ipAddresses: IpAddresses.cidr("10.0.0.0/16"),
      // Since this is a personal project, I'm only going to use public subnet
      // with no-ingress security groups because nat gateways are expensive
      natGateways: 0,
    });

    const fargateBase = new FargateBaseStack(
      this,
      `fargate-base-stack-${instanceId}`,
      {
        env: {
          region,
          account,
        },
        vpc,
        publicSubnet: vpc.publicSubnets[0],
      },
    );

    new FargateStack(this, `fargate-stack-${instanceId}`, {
      env: {
        region,
        account,
      },
      publicSubnet: vpc.publicSubnets[0],
      vpc,
      cluster: fargateBase.cluster,
      fargateExecutionRole: fargateBase.fargateExecutionRole,
      fargateTaskRole: fargateBase.fargateTaskRole,
      noIngressSecurityGroup: fargateBase.noIngressSecurityGroup,
    });
  }
}
