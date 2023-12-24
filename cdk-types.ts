import { NestedStackProps, StackProps } from "aws-cdk-lib";
import { ISubnet, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Cluster, FargateTaskDefinition } from "aws-cdk-lib/aws-ecs";
import { Role } from "aws-cdk-lib/aws-iam";
import { LogGroup } from "aws-cdk-lib/aws-logs";

export interface StackPropsWithBuildConfigAndNetworking
  extends NestedStackProps {
  env: {
    region: string;
    account: string;
  };
  publicSubnet: ISubnet;
  vpc: Vpc;
}

export interface FargateProps extends StackPropsWithBuildConfigAndNetworking {
  cluster: Cluster;
  fargateExecutionRole: Role;
  fargateTaskRole: Role;
  noIngressSecurityGroup: SecurityGroup;
  logGroup: LogGroup;
}

export interface BatchProcessorLambdaTopProps extends NestedStackProps {
  env: {
    region: string;
    account: string;
  };
  cluster: Cluster;
  noIngressSecurityGroup: SecurityGroup;
  publicSubnet: ISubnet;
  batchProcessorEcsGroup: string;
  executionRoleArn: string;
  taskRoleArn: string;
  orchestratorTaskDefinitionArn: string;
}
