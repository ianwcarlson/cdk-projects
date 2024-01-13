import {
  CreateQueueCommand,
  DeleteMessageBatchCommand,
  DeleteQueueCommand,
  ListQueuesCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { sqsClient } from "./sqs-client";

export interface SendMessageBatchInput {
  queueUrl: string;
  messages: Array<{
    id: string;
    messageBody: string;
    messageDeduplicationId?: string;
    messageGroupId?: string;
  }>;
}

export async function sendMessageBatch({
  queueUrl,
  messages,
}: SendMessageBatchInput) {
  const input = {
    // SendMessageBatchRequest
    QueueUrl: queueUrl,
    Entries: messages.map((m) => ({
      Id: m.id,
      MessageBody: m.messageBody,
      MessageDeduplicationId: m.messageDeduplicationId,
      MessageGroupId: m.messageGroupId,
    })),
  };

  const command = new SendMessageBatchCommand(input);
  return sqsClient.send(command);
  // { // SendMessageResult
  //   MD5OfMessageBody: "STRING_VALUE",
  //   MD5OfMessageAttributes: "STRING_VALUE",
  //   MD5OfMessageSystemAttributes: "STRING_VALUE",
  //   MessageId: "STRING_VALUE",
  //   SequenceNumber: "STRING_VALUE",
  // };
}

interface CreateQueueInput {
  queueName: string;
  delaySeconds?: number;
  maximumMessageSize?: number;
  messageRetentionPeriod?: number;
  receiveMessageWaitTimeSeconds?: number;
  visibilityTimeout?: number;
}

export async function createQueue({
  queueName,
  delaySeconds = 0,
  maximumMessageSize = 262144,
  messageRetentionPeriod = 345600,
  receiveMessageWaitTimeSeconds = 0,
  visibilityTimeout = 30,
}: CreateQueueInput) {
  const input = {
    // CreateQueueRequest
    QueueName: queueName,
    Attributes: {
      // QueueAttributeMap
      DelaySeconds: delaySeconds.toString(),
      MaximumMessageSize: maximumMessageSize.toString(),
      MessageRetentionPeriod: messageRetentionPeriod.toString(),
      ReceiveMessageWaitTimeSeconds: receiveMessageWaitTimeSeconds.toString(),
      VisibilityTimeout: visibilityTimeout.toString(),
    },
  };
  const command = new CreateQueueCommand(input);
  const response = await sqsClient.send(command);

  return response;
}

interface ReceiveMessageInput {
  queueUrl: string;
  attributeNames?: Array<
    | "All"
    | "Policy"
    | "VisibilityTimeout"
    | "MaximumMessageSize"
    | "MessageRetentionPeriod"
    | "ApproximateNumberOfMessages"
    | "ApproximateNumberOfMessagesNotVisible"
    | "CreatedTimestamp"
    | "LastModifiedTimestamp"
    | "QueueArn"
    | "ApproximateNumberOfMessagesDelayed"
    | "DelaySeconds"
    | "ReceiveMessageWaitTimeSeconds"
    | "RedrivePolicy"
    | "FifoQueue"
    | "ContentBasedDeduplication"
    | "KmsMasterKeyId"
    | "KmsDataKeyReusePeriodSeconds"
    | "DeduplicationScope"
    | "FifoThroughputLimit"
    | "RedriveAllowPolicy"
    | "SqsManagedSseEnabled"
  >;
  messageAttributeNames?: string[];
  maxNumberOfMessages?: number;
  visibilityTimeout?: number;
  waitTimeSeconds?: number;
  receiveRequestAttemptId?: string;
}

export async function receiveMessage({
  queueUrl,
  attributeNames = ["All"],
  messageAttributeNames = [],
  maxNumberOfMessages = 1,
  visibilityTimeout = 10,
  waitTimeSeconds = 20,
  receiveRequestAttemptId,
}: ReceiveMessageInput) {
  const input = {
    // ReceiveMessageRequest
    QueueUrl: queueUrl,
    AttributeNames: attributeNames,
    MessageAttributeNames: messageAttributeNames,
    MaxNumberOfMessages: maxNumberOfMessages,
    VisibilityTimeout: visibilityTimeout,
    WaitTimeSeconds: waitTimeSeconds,
    ReceiveRequestAttemptId: receiveRequestAttemptId,
  };
  const command = new ReceiveMessageCommand(input);
  const response = await sqsClient.send(command);

  const acknowledgeMessageReceived = async () => {
    if (response.Messages) {
      return deleteMessageBatch({
        queueUrl,
        entries: response.Messages.map((m) => {
          return {
            id: m.MessageId || "",
            receiptHandle: m.ReceiptHandle || "",
          };
        }),
      });
    }
    return null;
  };

  return { response, acknowledgeMessageReceived };
  // { // ReceiveMessageResult
  //   Messages: [ // MessageList
  //     { // Message
  //       MessageId: "STRING_VALUE",
  //       ReceiptHandle: "STRING_VALUE",
  //       MD5OfBody: "STRING_VALUE",
  //       Body: "STRING_VALUE",
  //       Attributes: { // MessageSystemAttributeMap
  //         "<keys>": "STRING_VALUE",
  //       },
  //       MD5OfMessageAttributes: "STRING_VALUE",
  //       MessageAttributes: { // MessageBodyAttributeMap
  //         "<keys>": { // MessageAttributeValue
  //           StringValue: "STRING_VALUE",
  //           BinaryValue: "BLOB_VALUE",
  //           StringListValues: [ // StringList
  //             "STRING_VALUE",
  //           ],
  //           BinaryListValues: [ // BinaryList
  //             "BLOB_VALUE",
  //           ],
  //           DataType: "STRING_VALUE", // required
  //         },
  //       },
  //     },
  //   ],
  // };
}

interface DeleteMessageBatchInput {
  queueUrl: string;
  entries: Array<{
    id: string;
    receiptHandle: string;
  }>;
}

export async function deleteMessageBatch({
  queueUrl,
  entries,
}: DeleteMessageBatchInput) {
  const input = {
    QueueUrl: queueUrl,
    Entries: entries.map((e) => ({ Id: e.id, ReceiptHandle: e.receiptHandle })),
  };
  const command = new DeleteMessageBatchCommand(input);
  return sqsClient.send(command);
}

export async function listQueues(queueNamePrefix: string = "") {
  let nextToken: string | undefined;
  const queueUrls: string[] = [];

  do {
    const input = {
      QueueNamePrefix: queueNamePrefix,
      NextToken: nextToken,
    };
    const command = new ListQueuesCommand(input);
    const response = await sqsClient.send(command);
    nextToken = response.NextToken;
    queueUrls.push(...(response.QueueUrls || []));
    console.log("queueUrls", queueUrls);
  } while (nextToken);

  return queueUrls.filter((url) => url.includes(queueNamePrefix));
}

export async function deleteQueue(queueUrl: string) {
  console.log("Deleting queue", queueUrl);

  const input = {
    QueueUrl: queueUrl,
  };
  const command = new DeleteQueueCommand(input);
  const response = await sqsClient.send(command);
  return response;
}

export async function purgeQueue(queueUrl: string) {
  const input = {
    QueueUrl: queueUrl,
  };
  const command = new PurgeQueueCommand(input);
  return sqsClient.send(command);
}
