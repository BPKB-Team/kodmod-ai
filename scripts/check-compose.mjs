// Validate resolved Compose without printing environment values or credentials.
import { readFileSync } from "node:fs";
const config = JSON.parse(readFileSync(0, "utf8"));
const mode = process.argv[2] || "local";
const services = config.services;
function requireThat(value, message) { if (!value) throw new Error(message); }
for (const name of ["postgres", "redis", "migrate", "ai-engine", "worker", "web"]) requireThat(services[name], `Missing ${name} service`);
const sources = service => new Map(service.volumes?.map(volume => [volume.target, `${volume.type}:${volume.source.replaceAll("\\", "/")}`]));
const api = sources(services["ai-engine"]);
for (const name of ["migrate", "worker"]) {
  const mounts = sources(services[name]);
  for (const target of ["/var/lib/kodmod/audio", "/var/lib/kodmod/uploads"]) requireThat(api.has(target) && mounts.get(target) === api.get(target), `${name} must share ${target} with API`);
}
for (const name of ["ai-engine", "worker"]) requireThat(services[name].depends_on?.migrate?.condition === "service_completed_successfully", `${name} must wait for migrations`);
requireThat(services.worker.healthcheck?.test?.some(part => part.includes("kodmod-worker-heartbeat")), "Worker must have a heartbeat healthcheck");
if (mode === "prod" || mode === "prod-private") {
  for (const name of ["prometheus", "grafana", "cadvisor", "node-exporter"]) requireThat(services[name], `Missing ${name} monitoring service`);
  if (mode === "prod") requireThat(services.caddy, "Missing HTTPS ingress");
  for (const [name, service] of Object.entries(services)) for (const port of service.ports || []) {
    const publicIngress = name === "caddy" && ["80", "443"].includes(String(port.published));
    const privateGrafana = name === "grafana" && port.host_ip === "127.0.0.1" && String(port.target) === "3000";
    const privateApp = mode === "prod-private" && ["web", "ai-engine"].includes(name) && port.host_ip === "127.0.0.1";
    requireThat((mode === "prod" && publicIngress) || privateGrafana || privateApp, "Unexpected public or private service port");
  }
  requireThat(services.web.environment?.SESSION_COOKIE_SECURE === (mode === "prod" ? "true" : "false"), "Session cookie must match the HTTPS or SSH-tunnel mode");
  if (mode === "prod-private") {
    requireThat(!services.caddy || (!services.caddy.ports?.length && services.caddy.profiles?.includes("https")), "Private mode must disable public ingress");
  } else {
    const domain = services.caddy.environment?.APP_DOMAIN || "";
    requireThat(domain.includes(".") && domain !== "localhost" && !/[\s/:]/.test(domain), "Configure a real APP_DOMAIN before HTTPS deployment");
    requireThat(Boolean(services.caddy.environment?.ACME_EMAIL), "Set ACME_EMAIL before HTTPS deployment");
    requireThat(services.caddy.ports?.some(port => String(port.published) === "443"), "HTTPS ingress must publish port 443");
  }
  requireThat(config.networks?.data?.internal && config.networks?.metrics?.internal, "Database and monitoring networks must be internal");
  for (const name of ["postgres", "redis", "ai-engine", "worker", "web"]) {
    requireThat(Number(services[name].mem_limit) > 0 && Number(services[name].pids_limit) > 0, `${name} needs resource limits`);
    requireThat(services[name].security_opt?.some(value => value.startsWith("no-new-privileges")), `${name} needs no-new-privileges`);
  }
  for (const name of ["ai-engine", "worker", "web", "redis"]) requireThat(services[name].read_only, `${name} must have a read-only root filesystem`);
  requireThat(Boolean(services.redis.environment?.REDIS_PASSWORD), "Redis authentication is required");
} else {
  for (const service of Object.values(services)) for (const port of service.ports || []) requireThat(port.host_ip === "127.0.0.1", "Local ports must bind to loopback");
}
console.log(`PASS ${mode} Compose topology, migrations, worker and shared storage`);
