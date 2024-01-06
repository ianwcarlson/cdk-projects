#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BatchProcessorStack } from "../applications/batch-processor/batch-processor-stack";
import { validateEnvVar } from "../utils";
import { ACCOUNT, REGION } from "../environment-variables";
import { MultiTenantQueueLambdaTop } from "../applications/multi-tenant-queue/lambda-top";
import { MultiTenantQueueStack } from "../applications/multi-tenant-queue/multi-tenant-queue-stack";

const account = validateEnvVar(ACCOUNT);
const region = validateEnvVar(REGION);

const app = new cdk.App();
new BatchProcessorStack(app, "BatchProcessorStack", {
  env: { account, region },
});

new MultiTenantQueueStack(app, "MultiTenantQueueStack", {
  env: { account, region },
});
