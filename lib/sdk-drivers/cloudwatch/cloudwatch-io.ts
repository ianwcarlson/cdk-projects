import {
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  DescribeLogGroupsCommand,
  DescribeLogGroupsCommandInput,
  LogGroupClass,
} from "@aws-sdk/client-cloudwatch-logs";
import { cloudwatchLogsClient } from "./cloudwatch-client";
import { log } from "console";

export async function createLogGroup(logGroupName: string) {
  const input = {
    logGroupName: logGroupName,
    logGroupClass: LogGroupClass.STANDARD,
  };
  const command = new CreateLogGroupCommand(input);
  return cloudwatchLogsClient.send(command);
}

export async function describeLogGroups(input: DescribeLogGroupsCommandInput) {
  const command = new DescribeLogGroupsCommand(input);
  return cloudwatchLogsClient.send(command);
}

interface CreateLogStreamInput {
  logGroupName: string;
  logStreamName: string;
}

export async function createLogStream({
  logGroupName,
  logStreamName,
}: CreateLogStreamInput) {
  const input = {
    logGroupName,
    logStreamName,
  };
  const command = new CreateLogStreamCommand(input);
  return cloudwatchLogsClient.send(command);
}

interface PutLogEventsInput {
  logGroupName: string;
  logStreamName: string;
  logMessages: Array<string>;
}

export async function PutLogEvents({
  logGroupName,
  logStreamName,
  logMessages,
}: PutLogEventsInput) {
  const input = {
    logGroupName,
    logStreamName,
    logEvents: logMessages.map((message) => ({
      message: message,
      timestamp: Date.now(),
    })),
  };
  const command = new CreateLogStreamCommand(input);
  return cloudwatchLogsClient.send(command);
}
