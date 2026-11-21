/** @file socket.ts @description Interview policy on the shared command socket. @module interviews */
import { createCommandSocket } from "../realtime/commandSocket";
import { InterviewError } from "./api";

export function createInterviewSocket(id: string) {
  return createCommandSocket({
    path: `/v1/interviews/${encodeURIComponent(id)}/events`,
    label: "Interview",
    error: (code, status, message) => new InterviewError(code, status, message),
  });
}

export type InterviewSocket = ReturnType<typeof createInterviewSocket>;
