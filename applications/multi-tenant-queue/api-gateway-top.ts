import {
  NestedStack,
  StackProps,
  aws_apigateway,
  aws_apigatewayv2,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { UserPool } from "aws-cdk-lib/aws-cognito";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AssetCode, Function, Runtime } from "aws-cdk-lib/aws-lambda";

export class ApiGatewayTop extends NestedStack {
  constructor(
    scope: Construct,
    id: string,
    lambdas: { [key: string]: NodejsFunction },
    userPool: UserPool,
    props?: StackProps,
  ) {
    super(scope, id, props);

    const authorizer = new aws_apigateway.CognitoUserPoolsAuthorizer(
      this,
      "api-authorizer",
      {
        cognitoUserPools: [userPool],
      },
    );

    const defaultHandler = new Function(this, "test-function", {
      runtime: Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: new AssetCode("src/lambda"),
    });

    new HttpLambdaIntegration("DefaultIntegration", defaultHandler);

    const api = new aws_apigatewayv2.HttpApi(this, "api");
  }
}
