import * as cdk from "aws-cdk-lib";
import {
  CfnNatGateway,
  IpAddresses,
  PrivateSubnet,
  PublicSubnet,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { Construct } from "constructs";
import {
  validateEnvVar,
} from "../utils";
import { ACCOUNT, INSTANCE_ID, REGION } from "../environment-variables";
import { FargateBaseStack } from "./ecs/fargate-base";
import { FargateStack } from "./ecs/fargate";
import { BatchProcessorLambdaTop } from "./lambda/lambda-top";

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
      vpc,
      publicSubnet: vpc.publicSubnets[0],
      cluster: fargateBase.cluster,
      fargateExecutionRole: fargateBase.fargateExecutionRole,
      fargateTaskRole: fargateBase.fargateTaskRole,
      noIngressSecurityGroup: fargateBase.noIngressSecurityGroup,
      logGroup: fargateBase.logGroup,
    });

    new BatchProcessorLambdaTop(this, `batch-processor-lambda-top-${instanceId}`, {
      env: {
        region,
        account,
      },
      cluster: fargateBase.cluster,
      noIngressSecurityGroup: fargateBase.noIngressSecurityGroup,
      publicSubnet: vpc.publicSubnets[0],
    });
  }
}
