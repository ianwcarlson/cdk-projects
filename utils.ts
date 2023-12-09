import { exec } from "child_process";

import { REGION } from "./environment-variables";

export function validateEnvVar(environmentVariableName: string): string {
  if (process.env[environmentVariableName]) {
    return process.env[environmentVariableName] || "";
  }
  throw new Error(`Unable to find ${environmentVariableName}`);
}

export function importRegionEnvVar() {
  let region = process.env[REGION];
  if (!region) {
    console.log(
      "REGION environment variable not provided, defaulting to us-east-1",
    );
    region = "us-west-1";
  }
  return region;
}

export async function execShellCommand(
  cmd: string,
  options: { [key: string]: string },
) {
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      { maxBuffer: 1000000000, ...options },
      (error, stdout, stderr) => {
        if (error) {
          console.error(error);
          reject(error);
        }
        resolve(stdout || stderr);
      },
    );
  });
}

export async function sleep(waitMS: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, waitMS);
  });
}

export function buildEcsClusterArnSSMKey(instanceId: string) {
  return `ecs-cluster-ssm-key-${instanceId}`;
}

export function buildSecurityGroupArnSSMKey(instanceId: string) {
  return `security-group-arn-ssm-key-${instanceId}`;
}
