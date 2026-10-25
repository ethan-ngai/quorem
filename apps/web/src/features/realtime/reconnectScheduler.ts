/** Schedules bounded reconnects; injected timers keep lifecycle behavior testable. */
export function createReconnectScheduler<T>(
  connect: () => void,
  schedule: (callback: () => void, delay: number) => T,
  cancel: (timer: T) => void,
  random: () => number = Math.random,
) {
  let retry = 0;
  let timer: T | undefined;

  return {
    schedule() {
      if (timer !== undefined) return;
      const ceiling = Math.min(10_000, 500 * 2 ** Math.min(retry, 5));
      const delay = Math.min(10_000, Math.round(ceiling * (0.8 + random() * 0.4)));
      retry += 1;
      timer = schedule(() => {
        timer = undefined;
        connect();
      }, delay);
    },
    reset() {
      retry = 0;
    },
    stop() {
      if (timer !== undefined) cancel(timer);
      timer = undefined;
    },
  };
}
