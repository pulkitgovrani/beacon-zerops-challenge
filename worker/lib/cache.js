import Redis from "ioredis";

let client;

export function getCache() {
  if (!client) {
    client = new Redis({
      host: process.env.CACHE_HOST,
      port: Number(process.env.CACHE_PORT || 6379),
      username: process.env.CACHE_PASSWORD ? "default" : undefined,
      password: process.env.CACHE_PASSWORD || undefined,
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    client.on("error", (err) => {
      console.error("cache error", err.message);
    });
  }
  return client;
}

export function statusKey(monitorId) {
  return `beacon:status:${monitorId}`;
}
