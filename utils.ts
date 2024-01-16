import { exec } from "child_process";

import { PARALLELISM, REGION } from "./environment-variables";

export function validateEnvVar(environmentVariableName: string): string {
  if (process.env[environmentVariableName]) {
    return process.env[environmentVariableName] || "";
  }
  throw new Error(`Unable to find ${environmentVariableName}`);
}

export function getEnvironmentParallelism() {
  return parseInt(process.env[PARALLELISM] || "1");
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

export function groupArray<T>(input: T[], groupSize: number) {
  const groups: T[][] = [[]];
  let groupCounter = 0;

  for (let i = 0; i < input.length; i += 1) {
    groups[groupCounter].push(input[i]);

    if (i % groupSize === groupSize - 1 && i < input.length - 1) {
      groupCounter += 1;
      groups.push([]);
    }
  }
  return groups;
}

export function didAnySettledPromisesFail<T>(
  results: PromiseSettledResult<T>[],
) {
  const failedResults = results.filter((result, idx, results) => {
    return result.status === "rejected";
  });
  return failedResults.length > 0;
}

export function getFulfilledValuesFromSettledPromises<T>(
  results: PromiseSettledResult<T>[],
) {
  return results.map((result) => {
    return result.status === "fulfilled" ? result.value : null;
  });
}

export function getFailedValuesFromSettledPromises<T>(
  results: PromiseSettledResult<T>[],
) {
  return results.reduce((acc: PromiseRejectedResult[], result) => {
    if (result.status === "rejected") {
      acc.push(result);
    }
    return acc;
  }, []);
}
