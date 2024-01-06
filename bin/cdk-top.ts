#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { BatchProcessorStack } from "../applications/batch-processor/batch-processor-stack";
import { validateEnvVar } from "../utils";
import { ACCOUNT, REGION } from "../environment-variables";

const account = validateEnvVar(ACCOUNT);
const region = validateEnvVar(REGION);

const app = new cdk.App();
new BatchProcessorStack(app, "BatchProcessorStack", {
  env: { account, region },
});
