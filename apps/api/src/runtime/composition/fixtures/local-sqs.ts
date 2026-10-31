/** @file local-sqs.ts @description Bounded in-memory SQS protocol fixture. @module runtime */
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

type Item = { body: string; visibleAt: number; receipt?: string };
export function localSqsFixture() {
  const items: Item[] = [];
  const actions: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 65536) request.destroy();
      else chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const target = request.headers["x-amz-target"];
        actions.push(String(target));
        if (actions.length > 100) actions.shift();
        let result: object;
        if (target === "AmazonSQS.SendMessage" && typeof body.MessageBody === "string") {
          if (items.length >= 1000) throw new Error("Fixture queue full");
          items.push({
            body: body.MessageBody,
            visibleAt: Date.now() + (body.DelaySeconds ?? 0) * 1000,
          });
          result = {
            MessageId: randomUUID(),
            MD5OfMessageBody: createHash("md5").update(body.MessageBody).digest("hex"),
          };
        } else if (target === "AmazonSQS.ReceiveMessage") {
          const selected = items
            .filter((item) => item.visibleAt <= Date.now())
            .slice(0, Math.min(body.MaxNumberOfMessages ?? 1, 10));
          result = {
            Messages: selected.map((item) => {
              item.receipt = randomUUID();
              item.visibleAt = Date.now() + 30000;
              return {
                Body: item.body,
                ReceiptHandle: item.receipt,
                MessageId: randomUUID(),
                MD5OfBody: createHash("md5").update(item.body).digest("hex"),
              };
            }),
          };
        } else if (target === "AmazonSQS.DeleteMessage") {
          const index = items.findIndex((item) => item.receipt === body.ReceiptHandle);
          if (index >= 0) items.splice(index, 1);
          result = {};
        } else if (target === "AmazonSQS.ChangeMessageVisibility") {
          const item = items.find((entry) => entry.receipt === body.ReceiptHandle);
          if (item) item.visibleAt = Date.now() + (body.VisibilityTimeout ?? 0) * 1000;
          result = {};
        } else throw new Error("Invalid fixture message");
        response
          .writeHead(200, { "content-type": "application/x-amz-json-1.0" })
          .end(JSON.stringify(result));
      } catch {
        response.writeHead(400).end();
      }
    });
  });
  return { server, size: () => items.length, actions: () => [...actions] };
}
