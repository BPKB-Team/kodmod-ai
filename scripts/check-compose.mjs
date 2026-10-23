// Validate resolved Compose without printing environment values or credentials.
import { readFileSync } from "node:fs";
const config = JSON.parse(readFileSync(0, "utf8"));
const mode = process.argv[2] || "local";
const services = config.services;
function requireThat(value, message) { if (!value) throw new Error(message); }
for (const name of ["postgres", "redis", "migrate", "ai-engine", "worker", "web"]) requireThat(services[name], `Missing ${name} service`);
const sources = service => new Map(service.volumes?.map(volume => [volume.target, `${volume.type}:${volume.source.replaceAll("\\", "/")}`]));
const networkNames = service => Array.isArray(service.networks) ? service.networks : Object.keys(service.networks || {});
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
    requireThat(services.caddy.ports?.some(port => String(port.published) === "443"), "HTTPS ingress must publish port 443");
  }
  requireThat(config.networks?.data?.internal && config.networks?.metrics?.internal, "Database and monitoring networks must be internal");
  for (const name of ["postgres", "redis", "ai-engine", "worker", "web"]) {
    requireThat(Number(services[name].mem_limit) > 0 && Number(services[name].pids_limit) > 0, `${name} needs resource limits`);
    requireThat(services[name].security_opt?.some(value => value.startsWith("no-new-privileges")), `${name} needs no-new-privileges`);
  }
  for (const name of ["ai-engine", "worker", "web", "redis"]) requireThat(services[name].read_only, `${name} must have a read-only root filesystem`);
  requireThat(Boolean(services.redis.environment?.REDIS_PASSWORD), "Redis authentication is required");
  for (const name of ["ai-engine", "worker"]) {
    const environment = services[name].environment || {};
    requireThat(environment.DB_HOST === "postgres" && environment.DB_PASSWORD, `${name} must retain its PostgreSQL configuration`);
    requireThat(environment.REDIS_HOST === "redis" && environment.REDIS_PASSWORD, `${name} must retain its Redis configuration`);
  }
  if (services.qdrant) {
    const qdrant = services.qdrant;
    const qdrantEnv = qdrant.environment || {};
    const clientEnv = services["ai-engine"].environment || {};
    const workerEnv = services.worker.environment || {};
    const qdrantNetworks = networkNames(qdrant);
    const apiNetworks = networkNames(services["ai-engine"]);
    const workerNetworks = networkNames(services.worker);
    const vectorMounts = sources(qdrant);
    requireThat(qdrant.profiles?.includes("qdrant"), "Qdrant must remain behind its explicit profile");
    requireThat(qdrant.image === "qdrant/qdrant:v1.19.2-unprivileged", "Qdrant image must be pinned to the unprivileged release");
    requireThat(qdrant.user === "1000:1000", "Qdrant must run as its unprivileged image user");
    requireThat(qdrant.read_only && qdrant.cap_drop?.includes("ALL"), "Qdrant needs a read-only root and dropped capabilities");
    requireThat(qdrant.security_opt?.some(value => value.startsWith("no-new-privileges")), "Qdrant needs no-new-privileges");
    requireThat(Number(qdrant.mem_limit) > 0 && Number(qdrant.cpus) > 0 && Number(qdrant.pids_limit) > 0, "Qdrant needs resource limits");
    requireThat(!qdrant.ports?.length, "Qdrant must not publish a host port");
    requireThat(qdrantNetworks.length === 1 && qdrantNetworks[0] === "vectors", "Qdrant must use only the isolated vector network");
    requireThat(config.networks?.vectors?.internal, "Qdrant vector network must be internal");
    requireThat(apiNetworks.includes("vectors") && workerNetworks.includes("vectors"), "API and worker must be attached to Qdrant's private network");
    for (const [name, service] of Object.entries(services)) {
      if (name !== "qdrant" && networkNames(service).includes("vectors")) {
        requireThat(["ai-engine", "worker"].includes(name), `${name} must not access the Qdrant network`);
      }
    }
    requireThat(qdrantEnv.QDRANT__SERVICE__API_KEY && qdrantEnv.QDRANT__SERVICE__API_KEY === clientEnv.QDRANT_API_KEY && qdrantEnv.QDRANT__SERVICE__API_KEY === workerEnv.QDRANT_API_KEY, "Qdrant and both clients must share a nonempty API key");
    requireThat(qdrantEnv.QDRANT__SERVICE__ENABLE_TLS === "true", "Qdrant TLS must be enabled");
    requireThat(qdrantEnv.QDRANT__TLS__CERT === "/qdrant/server.crt" && qdrantEnv.QDRANT__TLS__KEY === "/qdrant/server.key", "Qdrant must use mounted TLS credentials");
    requireThat(clientEnv.QDRANT_URL === "https://qdrant:6333" && workerEnv.QDRANT_URL === clientEnv.QDRANT_URL, "Qdrant clients must use HTTPS on the private service name");
    requireThat(clientEnv.QDRANT_CA_CERT_FILE === "/etc/ssl/certs/qdrant-ca.crt" && workerEnv.QDRANT_CA_CERT_FILE === clientEnv.QDRANT_CA_CERT_FILE, "Qdrant clients must verify the private CA");
    for (const name of ["ai-engine", "worker"]) {
      const mounts = sources(services[name]);
      requireThat(mounts.get("/etc/ssl/certs/qdrant-ca.crt")?.startsWith("bind:"), `${name} must mount the Qdrant trust certificate read-only`);
      const caMount = services[name].volumes.find(volume => volume.target === "/etc/ssl/certs/qdrant-ca.crt");
      requireThat(caMount?.read_only, `${name} Qdrant CA mount must be read-only`);
    }
    for (const target of ["/qdrant/storage", "/qdrant/snapshots"]) {
      requireThat(vectorMounts.get(target)?.startsWith("volume:"), `Qdrant ${target} must use persistent named storage`);
    }
    const qdrantServerCert = qdrant.volumes.find(volume => volume.target === "/qdrant/server.crt");
    const qdrantServerKey = qdrant.volumes.find(volume => volume.target === "/qdrant/server.key");
    requireThat(qdrantServerCert?.read_only && qdrantServerKey?.read_only, "Qdrant TLS certificate and key mounts must be read-only");
    const serverCertDirectory = qdrantServerCert?.source?.replaceAll("\\", "/").replace(/\/[^/]+$/, "");
    for (const name of ["ai-engine", "worker"]) {
      const caMount = services[name].volumes.find(volume => volume.target === "/etc/ssl/certs/qdrant-ca.crt");
      requireThat(caMount?.source?.replaceAll("\\", "/") === `${serverCertDirectory}/ca.crt`, `${name} must trust the Qdrant server's issuing CA`);
    }
  }
} else {
  for (const service of Object.values(services)) for (const port of service.ports || []) requireThat(port.host_ip === "127.0.0.1", "Local ports must bind to loopback");
}
console.log(`PASS ${mode} Compose topology, migrations, worker and shared storage${services.qdrant ? ", secured Qdrant isolation" : ""}`);
