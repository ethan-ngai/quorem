/** @file publisher.ts @description Route durable dispatch notices to provider channels. @module events */
import type {
  Notice,
  NoticePublisher,
  NoticeStream,
} from "../../../modules/events/dispatch/ports.ts";
export interface FanoutPublisher {
  publish(channel: string, notice: Notice): Promise<void>;
}
const prefix: Record<NoticeStream, string> = {
  interview: "interviews",
  match: "matches",
  party: "parties",
  team: "teams",
  submission: "submissions",
};
export const noticeChannel = (stream: NoticeStream, id: string) => `/${prefix[stream]}/${id}`;

export function noticePublisher(bus: FanoutPublisher): NoticePublisher {
  return {
    async publish(stream, notice) {
      await bus.publish(noticeChannel(stream, notice.aggregateId), notice);
    },
  };
}

export interface FanoutSubscriber {
  subscribe(
    channel: string,
    notice: (notice: Notice) => void,
    lost: () => void,
    signal: AbortSignal,
  ): Promise<() => void>;
}
export function socketSubscription(
  bus: FanoutSubscriber,
  channel: string,
): import("../../../modules/events/socket/ports.ts").SocketSubscription {
  return { subscribe: (notice, lost, signal) => bus.subscribe(channel, notice, lost, signal) };
}
