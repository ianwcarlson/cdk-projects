import {
  BATCH_PARALLELISM,
  ECS_CLUSTER_ARN,
  ECS_EXECUTION_ROLE_ARN,
  ECS_SECURITY_GROUP_ARN,
  ECS_SUBNET_ARN,
  ECS_TASK_ROLE_ARN,
  LOG_GROUP_NAME,
  REGION,
  WORKER_IMAGE_NAME,
} from "../environment-variables";
import * as EcsIO from "../lib/sdk-drivers/ecs/ecs-io";
import * as SqsIO from "../lib/sdk-drivers/sqs/sqs-io";
import * as CloudWatchLogsIO from "../lib/sdk-drivers/cloudwatch/cloudwatch-io";

process.env[REGION] = "REGION";
process.env[ECS_CLUSTER_ARN] = "CLUSTER_ARN";
process.env[ECS_SECURITY_GROUP_ARN] = "SECURITY_GROUP_ARN";
process.env[ECS_SUBNET_ARN] = "SUBNET_ARN";
process.env[BATCH_PARALLELISM] = "10";
process.env[ECS_EXECUTION_ROLE_ARN] = "EXECUTION_ROLE_ARN";
process.env[ECS_TASK_ROLE_ARN] = "TASK_ROLE_ARN";
process.env[WORKER_IMAGE_NAME] = "WORKER_IMAGE_NAME";
process.env[LOG_GROUP_NAME] = "LOG_GROUP_NAME";

import { orchestrator } from "../batch-processor-app/orchestrator";
import {
  JobStatus,
  JobStatusMessageBody,
} from "../batch-processor-app/job-types";

async function fetchInputData() {
  return Array.from(new Array(21)).map((_, i) => i);
}

test("Verify the orchestrator example", async () => {
  jest.spyOn(CloudWatchLogsIO, "createLogGroup").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
      logGroupArn: "arn:aws:logs:us-east-1:123456789012:log-group:my-log-group",
    }),
  );
  jest.spyOn(CloudWatchLogsIO, "createLogStream").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
    }),
  );
  jest.spyOn(CloudWatchLogsIO, "putLogEvents").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
    }),
  );

  jest.spyOn(SqsIO, "createQueue").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
      QueueUrl: "https://queue-url",
    }),
  );
  jest.spyOn(SqsIO, "deleteQueue").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
    }),
  );
  jest.spyOn(SqsIO, "sendMessageBatch").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
      Successful: [],
      Failed: [],
    }),
  );

  const mockResponse1: JobStatusMessageBody = {
    batchIndex: 0,
    processedData: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    jobProperties: {},
    status: JobStatus.SUCCESS,
  };
  const mockResponse2: JobStatusMessageBody = {
    batchIndex: 1,
    processedData: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    jobProperties: {},
    status: JobStatus.SUCCESS,
  };
  const mockResponse3: JobStatusMessageBody = {
    batchIndex: 2,
    processedData: [20],
    jobProperties: {},
    status: JobStatus.SUCCESS,
  };

  function generateReceiveMessageResponse(messageBody: JobStatusMessageBody) {
    return Promise.resolve({
      response: {
        $metadata: {},
        Messages: [
          {
            MessageId: "1",
            ReceiptHandle: "1",
            Body: JSON.stringify(messageBody),
          },
        ],
      },
      acknowledgeMessageReceived: async () => {
        return Promise.resolve({
          $metadata: {},
          Successful: [],
          Failed: [],
        });
      },
    });
  }
  const receiveMessageSpy = jest.spyOn(SqsIO, "receiveMessage");
  receiveMessageSpy
    .mockReturnValueOnce(generateReceiveMessageResponse(mockResponse1))
    .mockReturnValueOnce(generateReceiveMessageResponse(mockResponse2))
    .mockReturnValueOnce(generateReceiveMessageResponse(mockResponse3))
    .mockReturnValue(generateReceiveMessageResponse(mockResponse1));

  const deleteMessageBatchSpy = jest
    .spyOn(SqsIO, "deleteMessageBatch")
    .mockImplementation(() =>
      Promise.resolve({
        $metadata: {},
        Successful: [],
        Failed: [],
      }),
    );

  jest.spyOn(EcsIO, "registerTaskDefinition").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
      taskDefinition: {
        taskDefinitionArn:
          "arn:aws:ecs:us-east-1:123456789012:task-definition/my-task",
      },
    }),
  );
  jest.spyOn(EcsIO, "deregisterTaskDefinitions").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
    }),
  );
  jest.spyOn(EcsIO, "deleteTaskDefinitions").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
    }),
  );
  jest.spyOn(EcsIO, "deleteService").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
    }),
  );
  jest.spyOn(EcsIO, "createService").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
      service: {
        serviceArn: "arn:aws:ecs:us-east-1:123456789012:service/my-service",
      },
    }),
  );
  jest.spyOn(EcsIO, "stopTasksInService").mockImplementation(() =>
    Promise.resolve(),
  );
  jest.spyOn(EcsIO, "stopTask").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
      task: {
        taskArn: "arn:aws:ecs:us-east-1:123456789012:task/my-task",
      },
    }),
  );

  await orchestrator({
    handleGenerateInputData: fetchInputData,
    workerRunCommand: ["node worker-example.js"],
  });
});
