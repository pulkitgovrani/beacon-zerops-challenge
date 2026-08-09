export async function GET() {
  return Response.json({ ok: true, service: "beacon-app", time: new Date().toISOString() });
}
