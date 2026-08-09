import Redis from "ioredis";

let client;

export function getCache() {
  if (!client) {
    client = process.env.CACHE_URL
      ? new Redis(process.env.CACHE_URL, { maxRetriesPerRequest: 2 })
      : new Redis({
          host: process.env.CACHE_HOST,
          port: Number(process.env.CACHE_PORT || 6379),
          password: process.env.CACHE_PASSWORD || undefined,
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
