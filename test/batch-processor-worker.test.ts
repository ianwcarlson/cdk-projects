import {
  BATCH_PARALLELISM,
  ECS_CLUSTER_ARN,
  ECS_EXECUTION_ROLE_ARN,
  ECS_SECURITY_GROUP_ARN,
  ECS_SUBNET_ARN,
  ECS_TASK_ROLE_ARN,
  JOB_QUEUE_URL,
  JOB_STATUS_QUEUE_URL,
  LOG_GROUP_NAME,
  REGION,
  WORKER_IMAGE_NAME,
} from "../environment-variables";
import * as EcsIO from "../lib/sdk-drivers/ecs/ecs-io";
import * as SqsIO from "../lib/sdk-drivers/sqs/sqs-io";
import * as CloudWatchLogsIO from "../lib/sdk-drivers/cloudwatch/cloudwatch-io";

const BatchParallelism = 10;

process.env[REGION] = "REGION";
process.env[JOB_QUEUE_URL] = "JOB_QUEUE_URL";
process.env[JOB_STATUS_QUEUE_URL] = "JOB_STATUS_QUEUE_URL";

import { workerProcess } from "../batch-processor-app/worker";
import {
  JobMessageBody,
  JobMessageType,
  JobStatus,
} from "../batch-processor-app/job-types";

const handleProcessMessage = jest.fn(x => {
  return Promise.resolve({
    batchIndex: -1,
    status: JobStatus.SUCCESS,
    processedData: [],
    jobProperties: {},
  });
});

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

  const sendMessageBatchSpy = jest
    .spyOn(SqsIO, "sendMessageBatch")
    .mockImplementation(() =>
      Promise.resolve({
        $metadata: {},
        Successful: [],
        Failed: [],
      }),
    );

  const mockResponse1: JobMessageBody = {
    batchIndex: 0,
    data: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    jobProperties: {},
    messageType: JobMessageType.DATA,
  };
  const mockResponse2: JobMessageBody = {
    batchIndex: 1,
    data: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    jobProperties: {},
    messageType: JobMessageType.DATA,
  };
  const mockResponse3: JobMessageBody = {
    batchIndex: 2,
    data: [20],
    jobProperties: {},
    messageType: JobMessageType.DATA,
  };
  const mockResponse4: JobMessageBody = {
    batchIndex: -1,
    data: [],
    jobProperties: {},
    messageType: JobMessageType.SHUTDOWN,
  };

  function generateReceiveMessageResponse(messageBody: JobMessageBody) {
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
    .mockReturnValue(generateReceiveMessageResponse(mockResponse4));

  jest.spyOn(SqsIO, "deleteMessageBatch").mockImplementation(() =>
    Promise.resolve({
      $metadata: {},
      Successful: [],
      Failed: [],
    }),
  );

  await workerProcess({
    handleProcessMessage,
  });

  expect(createLogStreamSpy).toHaveBeenCalledTimes(1);
  expect(putLogEventsSpy).toHaveBeenCalled();
  expect(sendMessageBatchSpy).toHaveBeenCalledTimes(3);
  expect(receiveMessageSpy).toHaveBeenCalledTimes(4);

  expect(handleProcessMessage).toHaveBeenCalledTimes(3);
  expect(handleProcessMessage).toHaveNthReturnedWith(
    1,
    Promise.resolve({
      batchIndex: 0,
      status: JobStatus.SUCCESS,
      processedData: [],
      jobProperties: {},
    }),
  );
  expect(handleProcessMessage).toHaveNthReturnedWith(
    2,
    Promise.resolve({
      batchIndex: 1,
      status: JobStatus.SUCCESS,
      processedData: [],
      jobProperties: {},
    }),
  );
  expect(handleProcessMessage).toHaveNthReturnedWith(
    3,
    Promise.resolve({
      batchIndex: 2,
      status: JobStatus.SUCCESS,
      processedData: [],
      jobProperties: {},
    }),
  );
});
