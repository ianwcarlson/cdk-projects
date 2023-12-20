import {
  CreateLogGroupCommand,
  DescribeLogGroupsCommand,
  DescribeLogGroupsCommandInput,
  LogGroupClass,
} from "@aws-sdk/client-cloudwatch-logs";
import { cloudwatchLogsClient } from "./cloudwatch-client";

export async function createLogGroup(logGroupName: string) {
  const input = {
    logGroupName: logGroupName,
    logGroupClass: LogGroupClass.STANDARD,
  };
  const command = new CreateLogGroupCommand(input);
  return cloudwatchLogsClient.send(command);
}

export async function describeLogGroups(
  input: DescribeLogGroupsCommandInput,
) {
  const command = new DescribeLogGroupsCommand(input);
  return cloudwatchLogsClient.send(command);
}
