/** @file ports.ts @description Durable notice dispatch boundaries. @module events */
export type Stream = "interview" | "match" | "submission" | "membership" | "execution";
export type NoticeStream = Exclude<Stream, "execution">;
export interface Notice {
  id: string;
  aggregateId: string;
  version: string;
  type: string;
  occurredAt: string;
}
export interface Claim {
  stream: Stream;
  id: string;
  token: string;
  notice?: Notice;
  jobId?: string;
}
export interface DispatchStore {
  claim(stream: Stream, limit: number, leaseMs: number): Promise<Claim[]>;
  acknowledge(claim: Claim): Promise<boolean>;
  pending(stream: Stream): Promise<boolean>;
}
export interface NoticePublisher {
  publish(stream: NoticeStream, notice: Notice): Promise<void>;
}
export interface ExecutionWakePublisher {
  send(wake: Wake, delaySeconds?: number): Promise<void>;
}
export interface Wake {
  jobId: string;
  phase: "admission" | "continuation";
  admissionUntil?: number;
}
