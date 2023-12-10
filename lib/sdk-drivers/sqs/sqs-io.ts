import {
  CreateQueueCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { sqsClient } from "./sqs-client";

export interface SendMessageBatchInput {
  queueUrl: string;
  messages: Array<{ id: string; messageBody: string }>;
}

export async function sendMessageBatch({
  queueUrl,
  messages,
}: SendMessageBatchInput) {
  const input = {
    // SendMessageBatchRequest
    QueueUrl: queueUrl,
    Entries: messages.map((m) => ({ Id: m.id, MessageBody: m.messageBody })),
  };

  const command = new SendMessageBatchCommand(input);
  const response = await sqsClient.send(command);
  return { rawResponse: response };
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
  // { // CreateQueueResult
  //   QueueUrl: "STRING_VALUE",
  // };

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
  waitTimeSeconds = 30,
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
  return response;
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

export async function getQueueStatus() {}
