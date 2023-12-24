import {
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  DescribeLogGroupsCommand,
  DescribeLogGroupsCommandInput,
  LogGroupClass,
  PutLogEventsCommand,
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
  logEvents: Array<{
    timestamp: number;
    message: string;
  }>;
}

export async function putLogEvents({
  logGroupName,
  logStreamName,
  logEvents,
}: PutLogEventsInput) {
  if (logEvents.length > 0) {
    const input = {
      logGroupName,
      logStreamName,
      logEvents,
    };
    const command = new PutLogEventsCommand(input);
    return cloudwatchLogsClient.send(command);
  }
}
