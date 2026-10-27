const webhookUrl = process.env.HARK_WEBHOOK_URL;
if (!webhookUrl) {
  throw new Error("Set HARK_WEBHOOK_URL to the destination webhook before sending.");
}

const origin = process.env.HARK_PUBLIC_URL ?? "https://hark.fyi";
const delayMs = Number(process.env.HARK_TEASER_DELAY_MS ?? 2000);
if (!Number.isFinite(delayMs) || delayMs < 0) {
  throw new Error("HARK_TEASER_DELAY_MS must be a positive number.");
}

const sequence = [
  { body: "how", image: "how.jpg" },
  { body: "do", image: "do.jpg" },
  { body: "you", image: "you.jpg" },
  { body: "communicate?", image: "communicate.jpg" },
];
const runId = Date.now();

for (const [index, notification] of sequence.entries()) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": `hark-teaser-${runId}-${index}`,
    },
    body: JSON.stringify({
      title: "hark",
      body: notification.body,
      imageUrl: `${origin}/teaser/${notification.image}`,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Failed to send "${notification.body}" (${response.status}): ${JSON.stringify(result)}`,
    );
  }
  console.log(`Sent "${notification.body}" to ${result?.delivered ?? 0} device(s).`);

  if (index < sequence.length - 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
