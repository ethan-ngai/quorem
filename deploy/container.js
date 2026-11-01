import { APP_IDLE_MS, isSocketRequest } from "./policy.js";

/** One cold readiness probe per boot; warm commands are forwarded exactly once. */
export class ContainerLifecycle {
  constructor(
    ctx,
    runtime,
    port,
    timeout = 60_000,
    idleMs = APP_IDLE_MS,
    instance,
    readinessHeaders,
  ) {
    this.ctx = ctx;
    this.runtime = runtime;
    this.port = port;
    this.timeout = timeout;
    this.idleMs = idleMs;
    this.instance = instance;
    this.readinessHeaders = readinessHeaders;
    this.ready = false;
    this.boot = 0;
  }

  async ensureReady() {
    if (this.stopping) await this.stopping;
    if (this.ready && this.ctx.container.running) return;
    this.starting ??= this.start().finally(() => {
      this.starting = undefined;
    });
    await this.starting;
  }

  async start() {
    const started = performance.now();
    const container = this.ctx.container;
    if (!container) throw new Error("Container unavailable");
    if (!container.running) {
      this.boot++;
      this.expectedStop = false;
      const options = { enableInternet: true, env: this.runtime };
      if (this.instance) {
        if (!container.images?.judge) throw new Error("Judge image unavailable");
        options.image = container.images.judge;
        options.instance = this.instance;
      }
      container.start(options);
    }
    await container.setInactivityTimeout(this.idleMs);
    if (this.monitoring !== this.boot) {
      const boot = this.boot;
      this.monitoring = boot;
      this.ctx.waitUntil(
        container
          .monitor()
          .catch(() => {
            if (!this.expectedStop && boot === this.boot)
              console.error("Container exited unexpectedly");
          })
          .finally(() => {
            if (boot === this.boot) {
              this.ready = false;
              this.monitoring = undefined;
            }
          }),
      );
    }
    const deadline = Date.now() + this.timeout;
    let probes = 0,
      status = 0,
      failure = "none";
    while (Date.now() < deadline) {
      probes++;
      try {
        const response = await container.getTcpPort(this.port).fetch("http://container/health", {
          signal: AbortSignal.timeout(2000),
          headers: this.readinessHeaders,
          redirect: "error",
        });
        status = response.status;
        failure = "http";
        await response.body?.cancel();
        if (response.ok) {
          console.log(
            `Container ready port=${this.port} duration_ms=${Math.round(performance.now() - started)}`,
          );
          this.ready = true;
          return;
        }
      } catch (error) {
        const message = String(error?.message ?? "");
        failure = /refused/i.test(message)
          ? "refused"
          : /reset|closed|lost/i.test(message)
            ? "closed"
            : /timeout|timed out|abort/i.test(message)
              ? "timeout"
              : /not.*running|not.*started/i.test(message)
                ? "stopped"
                : /unsupported|not implemented/i.test(message)
                  ? "unsupported"
                  : "transport";
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const error = new Error("Container readiness timed out");
    error.readiness = {
      port: this.port,
      probes,
      status,
      failure,
      running: container.running === true,
    };
    throw error;
  }

  stop() {
    this.stopping ??= (async () => {
      this.expectedStop = true;
      this.ready = false;
      await this.ctx.container.destroy();
      this.boot++;
    })().finally(() => {
      this.stopping = undefined;
    });
    return this.stopping;
  }

  async forward(request, timeout = 120_000) {
    await this.ensureReady();
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    for (const key of [
      "host",
      "x-quorem-pool",
      "x-quorem-lease",
      "x-quorem-slot",
      "x-quorem-revision",
    ])
      forwarded.headers.delete(key);
    const upgrade = isSocketRequest(request);
    const controller = upgrade ? new AbortController() : undefined;
    const timer = controller
      ? setTimeout(() => controller.abort(), Math.min(timeout, 15_000))
      : undefined;
    try {
      return await this.ctx.container
        .getTcpPort(this.port)
        .fetch(forwarded, { signal: controller?.signal ?? AbortSignal.timeout(timeout) });
    } catch (error) {
      this.ready = false;
      throw error;
    } finally {
      // Only the upgrade handshake is bounded; established sockets have no request lifetime timer.
      clearTimeout(timer);
    }
  }
}
