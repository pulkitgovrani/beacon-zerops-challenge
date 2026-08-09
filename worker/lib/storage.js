import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

let client;

function getClient() {
  if (!client) {
    client = new S3Client({
      region: "us-east-1",
      endpoint: process.env.STORAGE_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

export async function uploadIncidentReport(incidentId, report) {
  if (!process.env.STORAGE_BUCKET || !process.env.STORAGE_ENDPOINT) return null;
  const key = `incidents/${incidentId}.json`;
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.STORAGE_BUCKET,
      Key: key,
      Body: JSON.stringify(report, null, 2),
      ContentType: "application/json",
    })
  );
  return `${process.env.STORAGE_ENDPOINT}/${process.env.STORAGE_BUCKET}/${key}`;
}
