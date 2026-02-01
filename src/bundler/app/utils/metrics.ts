import { register, Counter, Gauge, Histogram, collectDefaultMetrics } from "prom-client";

collectDefaultMetrics({
  register,
  prefix: "",
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
  eventLoopMonitoringPrecision: 10
});

export const sessionCounter = new Counter({
  name: "mcp_bundler_sessions_total",
  help: "Total number of sessions created",
  labelNames: ["bundle_id"]
});

export const activeSessionsGauge = new Gauge({
  name: "mcp_bundler_active_sessions",
  help: "Current number of active sessions"
});



export const upstreamConnectionsGauge = new Gauge({
  name: "mcp_bundler_upstream_connections",
  help: "Current number of upstream connections",
  labelNames: ["namespace"]
});

export const requestDurationHistogram = new Histogram({
  name: "mcp_bundler_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});

export const upstreamRequestDurationHistogram = new Histogram({
  name: "mcp_bundler_upstream_request_duration_seconds",
  help: "Upstream request duration in seconds",
  labelNames: ["namespace", "operation"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10]
});

export const upstreamErrorCounter = new Counter({
  name: "mcp_bundler_upstream_errors_total",
  help: "Total number of upstream errors",
  labelNames: ["namespace", "operation", "error_type"]
});

export const sessionTerminationsCounter = new Counter({
  name: "mcp_bundler_session_terminations_total",
  help: "Total number of session terminations",
  labelNames: ["reason"]
});

// Aliases for test compatibility
export const upstreamCounter = new Counter({
  name: "mcp_bundler_upstreams_total",
  help: "Total number of upstream connections",
  labelNames: ["namespace", "bundle_id"]
});

export const requestDuration = requestDurationHistogram;

export async function getPrometheusMetrics(): Promise<string> {
  return register.metrics();
}

export function resetMetrics(): void {
  register.clear();
}
