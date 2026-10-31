/** @file sqs.ts @description Node SQS execution wake queue. @module delivery */
import {
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { encodeWake, decodeWake, validateDelay, validateRetryDelay } from "./wire.ts";
import { validateLimit, validateReceipt, type WakeQueue } from "./queue.ts";

export function sqsQueue(queueUrl: string, client = new SQSClient({})): WakeQueue {
  const url = new URL(queueUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Invalid SQS queue URL");
  return {
    async send(wake, delaySeconds = 0) {
      const body = encodeWake(wake);
      validateDelay(delaySeconds);
      try {
        await client.send(
          new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: body,
            DelaySeconds: delaySeconds,
          }),
          { abortSignal: AbortSignal.timeout(25_000) },
        );
      } catch {
        throw new Error("Execution wake unavailable");
      }
    },
    async receive(limit) {
      validateLimit(limit);
      try {
        const result = await client.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: limit,
            WaitTimeSeconds: 20,
            VisibilityTimeout: 30,
          }),
          { abortSignal: AbortSignal.timeout(25_000) },
        );
        if ((result.Messages?.length ?? 0) > limit) throw new Error();
        return (result.Messages ?? []).map((message) => {
          const receipt = message.ReceiptHandle ?? "";
          validateReceipt(receipt);
          return { wake: decodeWake(message.Body ?? ""), receipt };
        });
      } catch {
        throw new Error("Execution wake unavailable");
      }
    },
    async ack(receipt) {
      validateReceipt(receipt);
      try {
        await client.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receipt }),
          { abortSignal: AbortSignal.timeout(25_000) },
        );
      } catch {
        throw new Error("Execution wake unavailable");
      }
    },
    async retry(receipt, delaySeconds) {
      validateReceipt(receipt);
      validateRetryDelay(delaySeconds);
      try {
        await client.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: receipt,
            VisibilityTimeout: delaySeconds,
          }),
          { abortSignal: AbortSignal.timeout(25_000) },
        );
      } catch {
        throw new Error("Execution wake unavailable");
      }
    },
  };
}
