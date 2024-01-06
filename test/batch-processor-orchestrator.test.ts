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

const BatchParallelism = 10;

process.env[REGION] = "REGION";
process.env[ECS_CLUSTER_ARN] = "CLUSTER_ARN";
process.env[ECS_SECURITY_GROUP_ARN] = "SECURITY_GROUP_ARN";
process.env[ECS_SUBNET_ARN] = "SUBNET_ARN";
process.env[BATCH_PARALLELISM] = BatchParallelism.toString();
process.env[ECS_EXECUTION_ROLE_ARN] = "EXECUTION_ROLE_ARN";
process.env[ECS_TASK_ROLE_ARN] = "TASK_ROLE_ARN";
process.env[WORKER_IMAGE_NAME] = "WORKER_IMAGE_NAME";
process.env[LOG_GROUP_NAME] = "LOG_GROUP_NAME";

import { orchestrator } from "../applications/batch-processor/orchestrator";
import {
  JobMessageType,
  JobStatus,
  JobStatusMessageBody,
} from "../applications/batch-processor/job-types";

async function fetchInputData() {
  return Array.from(new Array(21)).map((_, i) => i);
}

const QueueUrl = "https://queue-url";

test("Verify the orchestrator example", async () => {
  const createLogStreamSpy = jest
    .spyOn(CloudWatchLogsIO, "createLogStream")
    .mockImplementation(() =>
      Promise.resolve({
        $metadata: {},
      }),
    );
  const putLogEventsSpy = jest
    .spyOn(CloudWatchLogsIO, "putLogEvents")
    .mockImplementation(() =>
      Promise.resolve({
        $metadata: {},
      }),
    );

  const createQueueSpy = jest
    .spyOn(SqsIO, "createQueue")
    .mockImplementation(() =>
      Promise.resolve({
        $metadata: {},
        QueueUrl,
      }),
    );
  const deleteQueueSpy = jest
    .spyOn(SqsIO, "deleteQueue")
    .mockImplementation(() =>
      Promise.resolve({
        $metadata: {},
      }),
    );
  const sendMessageBatchSpy = jest
    .spyOn(SqsIO, "sendMessageBatch")
    .mockImplementation(() =>
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
    .mockReturnValue(
      Promise.resolve({
        response: {
          $metadata: {},
          Messages: [],
        },
        acknowledgeMessageReceived: async () => {
          return Promise.resolve({
            $metadata: {},
            Successful: [],
            Failed: [],
          });
        },
      }),
    );

  jest.spyOn(SqsIO, "deleteMessageBatch").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
      Successful: [],
      Failed: [],
    }),
  );

  const registerTaskDefinitionSpy = jest
    .spyOn(EcsIO, "registerTaskDefinition")
    .mockImplementation(() =>
      Promise.resolve({
        $metadata: {},
        taskDefinition: {
          taskDefinitionArn:
            "arn:aws:ecs:us-east-1:123456789012:task-definition/my-task",
        },
      }),
    );
  const deregisterTaskDefinitionsSpy = jest
    .spyOn(EcsIO, "deregisterTaskDefinitions")
    .mockImplementation(() =>
      Promise.resolve({
        $metadata: {},
      }),
    );
  const deleteTaskDefinitionsSpy = jest
    .spyOn(EcsIO, "deleteTaskDefinitions")
    .mockImplementation(() =>
      Promise.resolve({
        $metadata: {},
      }),
    );
  const deleteServiceSpy = jest
    .spyOn(EcsIO, "deleteService")
    .mockImplementation(() =>
      Promise.resolve({
        $metadata: {},
      }),
    );
  const createServiceSpy = jest
    .spyOn(EcsIO, "createService")
    .mockImplementation(() =>
      Promise.resolve({
        $metadata: {},
        service: {
          serviceArn: "arn:aws:ecs:us-east-1:123456789012:service/my-service",
        },
      }),
    );
  const stopTasksInServiceSpy = jest
    .spyOn(EcsIO, "stopTasksInService")
    .mockImplementation(() => Promise.resolve());
  const stopTaskSpy = jest.spyOn(EcsIO, "stopTask").mockImplementation(() =>
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

  expect(createLogStreamSpy).toHaveBeenCalledTimes(1);
  expect(putLogEventsSpy).toHaveBeenCalled();
  expect(createQueueSpy).toHaveBeenCalledTimes(2);
  expect(deleteQueueSpy).toHaveBeenCalledTimes(2);
  expect(sendMessageBatchSpy).toHaveBeenCalledTimes(3 + BatchParallelism);
  expect(registerTaskDefinitionSpy).toHaveBeenCalledTimes(1);
  expect(deleteTaskDefinitionsSpy).toHaveBeenCalledTimes(1);
  expect(deleteServiceSpy).toHaveBeenCalledTimes(1);
  expect(createServiceSpy).toHaveBeenCalledTimes(1);
  expect(stopTasksInServiceSpy).toHaveBeenCalledTimes(1);
  expect(receiveMessageSpy).toHaveBeenCalledTimes(4);

  expect(sendMessageBatchSpy).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      queueUrl: QueueUrl,
      messages: [
        expect.objectContaining({
          messageBody: JSON.stringify({
            batchIndex: 0,
            data: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
            jobProperties: {},
            messageType: JobMessageType.DATA,
          }),
        }),
      ],
    }),
  );
  expect(sendMessageBatchSpy).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      queueUrl: QueueUrl,
      messages: [
        expect.objectContaining({
          messageBody: JSON.stringify({
            batchIndex: 1,
            data: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
            jobProperties: {},
            messageType: JobMessageType.DATA,
          }),
        }),
      ],
    }),
  );
  expect(sendMessageBatchSpy).toHaveBeenNthCalledWith(
    3,
    expect.objectContaining({
      queueUrl: QueueUrl,
      messages: [
        expect.objectContaining({
          messageBody: JSON.stringify({
            batchIndex: 2,
            data: [20],
            jobProperties: {},
            messageType: JobMessageType.DATA,
          }),
        }),
      ],
    }),
  );
  for (let i = 4; i < 4 + BatchParallelism; i++) {
    expect(sendMessageBatchSpy).toHaveBeenNthCalledWith(
      i,
      expect.objectContaining({
        queueUrl: QueueUrl,
        messages: [
          expect.objectContaining({
            messageBody: JSON.stringify({
              batchIndex: -1,
              data: [],
              jobProperties: {},
              messageType: JobMessageType.SHUTDOWN,
            }),
          }),
        ],
      }),
    );
  }
});
