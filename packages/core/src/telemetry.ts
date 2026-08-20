import { cpus, freemem, loadavg, totalmem } from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { HostTelemetrySample } from "./models.js";

export interface TelemetrySink {
  readonly write: (sample: HostTelemetrySample) => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface HostTelemetryOptions {
  readonly intervalMs?: number;
  readonly activeAgentWorkers: () => number;
  readonly onError?: (error: unknown) => void;
}

interface CpuSnapshot {
  readonly timestampMs: number;
  readonly totalIdle: number;
  readonly totalBusy: number;
  readonly perCoreIdle: readonly number[];
  readonly perCoreBusy: readonly number[];
}

function cpuSnapshot(): CpuSnapshot {
  const cores = cpus();
  let totalIdle = 0;
  let totalBusy = 0;
  const perCoreIdle: number[] = [];
  const perCoreBusy: number[] = [];
  for (const core of cores) {
    const { idle, ...busyTimes } = core.times;
    const coreBusy = Object.values(busyTimes).reduce((sum, value) => sum + value, 0);
    perCoreIdle.push(idle);
    perCoreBusy.push(coreBusy);
    totalIdle += idle;
    totalBusy += coreBusy;
  }
  return { timestampMs: performance.now(), totalIdle, totalBusy, perCoreIdle, perCoreBusy };
}

function utilization(
  previous: CpuSnapshot,
  current: CpuSnapshot,
): { readonly total: number | null; readonly perCore: readonly (number | null)[] } {
  const elapsed = current.totalIdle + current.totalBusy - (previous.totalIdle + previous.totalBusy);
  if (elapsed <= 0) return { total: null, perCore: [] };
  const total = 1 - (current.totalIdle - previous.totalIdle) / elapsed;
  const perCore = current.perCoreIdle.map((idle, index) => {
    const previousIdle = previous.perCoreIdle[index];
    const previousBusy = previous.perCoreBusy[index];
    const currentBusy = current.perCoreBusy[index];
    if (previousIdle === undefined || previousBusy === undefined || currentBusy === undefined) {
      return null;
    }
    const coreElapsed = idle + currentBusy - (previousIdle + previousBusy);
    if (coreElapsed <= 0) return null;
    return 1 - (idle - previousIdle) / coreElapsed;
  });
  return { total, perCore };
}

export interface HostTelemetrySampler {
  readonly start: () => void;
  readonly stop: () => Promise<void>;
  readonly active: boolean;
}

export function createHostTelemetrySampler(
  sink: TelemetrySink,
  options: HostTelemetryOptions,
): HostTelemetrySampler {
  const intervalMs = options.intervalMs ?? 1_000;
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  let previous = cpuSnapshot();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const sample = async (): Promise<void> => {
    if (stopped) return;
    const current = cpuSnapshot();
    const usage = utilization(previous, current);
    previous = current;
    const sample: HostTelemetrySample = {
      timestamp: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - current.timestampMs),
      totalCpuUtilization: usage.total === null ? null : Math.min(1, Math.max(0, usage.total)),
      perCoreCpuUtilization: usage.perCore.map((value) =>
        value === null ? null : Math.min(1, Math.max(0, value)),
      ),
      loadAverage1m: loadavg()[0] ?? null,
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      parentRssBytes: process.memoryUsage().rss,
      activeAgentWorkers: options.activeAgentWorkers(),
      eventLoopLagMs: eventLoop.mean / 1_000_000,
    };
    await sink.write(sample);
  };

  const tick = (): void => {
    if (stopped) return;
    timer = setTimeout(async () => {
      try {
        await sample();
      } catch (error: unknown) {
        options.onError?.(error);
      }
      tick();
    }, intervalMs);
    timer.unref();
  };

  return {
    active: true,
    start: () => {
      eventLoop.enable();
      tick();
    },
    stop: async () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      eventLoop.disable();
      await sink.close();
    },
  };
}
