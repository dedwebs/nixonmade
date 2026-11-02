#!/usr/bin/env node
/**
 * End-to-end check against `wrangler dev` in Stripe TEST mode.
 *
 *   npm run dev
 *   SESSION_ID=cs_test_... npm run e2e:download
 *
 * Optional refund simulation (does not call Stripe; signs a local webhook):
 *   SESSION_ID=cs_test_... PAYMENT_INTENT=pi_... STRIPE_WEBHOOK_SECRET=whsec_... \
 *     npm run e2e:download -- --simulate-refund
 *
 * Refuses live session ids, live keys, and any BASE_URL that is not localhost.
 * Never prints the restricted key, the webhook secret, or a full session id.
 */

import { createHmac } from "node:crypto";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:8787";
const sessionId = process.env.SESSION_ID ?? "";
const simulateRefund = process.argv.includes("--simulate-refund");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function redact(id) {
  if (id.length < 12) return "[redacted]";
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

const url = new URL(baseUrl);
if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
  fail("BASE_URL must be localhost. This script does not talk to production.");
}
if (!sessionId) {
  fail(
    "Set SESSION_ID to the cs_test_ id from the /thanks page after a test-mode payment. See the README checklist.",
  );
}
if (!sessionId.startsWith("cs_test_") || sessionId.startsWith("cs_live_")) {
  fail("Refusing this session id. Use a Stripe TEST checkout (cs_test_), never cs_live_.");
}
const restricted = process.env.STRIPE_RESTRICTED_KEY ?? "";
if (restricted.startsWith("rk_live_") || restricted.startsWith("sk_")) {
  fail("Refusing a live or unrestricted key. Do not put real live keys in the environment for this script.");
}

async function readJson(response) {
  const text = await response.text();
  try {
    return { status: response.status, json: JSON.parse(text), text };
  } catch {
    return { status: response.status, json: null, text };
  }
}

const home = await fetch(new URL("/", url));
if (!home.ok) fail(`wrangler dev is not answering at ${url.origin} (GET / returned ${home.status}).`);

const download = await readJson(
  await fetch(new URL(`/api/download?session_id=${encodeURIComponent(sessionId)}`, url)),
);
if (download.status !== 200 || !download.json?.files?.[0]?.url) {
  fail(
    `Download API returned ${download.status}. Confirm the test Payment Link ids, the restricted test key, and that the R2 object is uploaded locally. Body was not printed because it can carry a file token.`,
  );
}
console.log(`Paid session ${redact(sessionId)} maps to ${download.json.product}.`);
console.log(`Downloads remaining before this file: ${download.json.downloads_remaining}.`);
console.log(`File link expires at ${download.json.expires_at}.`);

const fileUrl = new URL(download.json.files[0].url, url);
const file = await fetch(fileUrl);
if (!file.ok) fail(`File link returned ${file.status}.`);
const bytes = new Uint8Array(await file.arrayBuffer());
if (bytes.byteLength < 1) fail("File link returned an empty body.");
const disposition = file.headers.get("content-disposition") ?? "";
console.log(`Downloaded ${bytes.byteLength} bytes (${disposition}).`);

const tampered = new URL(fileUrl);
tampered.searchParams.set("t", `${tampered.searchParams.get("t") ?? ""}x`);
const broken = await fetch(tampered);
if (broken.status !== 404) fail(`Tampered link returned ${broken.status}, expected 404.`);
console.log("Tampered link was rejected.");

if (!simulateRefund) {
  console.log("");
  console.log("Manual checks still to do: wait 15 minutes and reuse the button (it should fail; refresh /thanks for a new one), download five separate times, and refund the test payment.");
  console.log("Refund simulation: rerun with --simulate-refund, PAYMENT_INTENT, and STRIPE_WEBHOOK_SECRET from .dev.vars.");
  process.exit(0);
}

const paymentIntent = process.env.PAYMENT_INTENT ?? "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
if (!paymentIntent.startsWith("pi_") || webhookSecret.length < 16) {
  fail("Refund simulation needs PAYMENT_INTENT=pi_... and STRIPE_WEBHOOK_SECRET from the same .dev.vars as wrangler dev.");
}
const payload = JSON.stringify({
  id: "evt_e2e_refund",
  type: "charge.refunded",
  data: {
    object: {
      object: "charge",
      refunded: true,
      amount_refunded: 100,
      payment_intent: paymentIntent,
    },
  },
});
const stamp = Math.floor(Date.now() / 1000);
const mac = createHmac("sha256", webhookSecret).update(`${stamp}.${payload}`).digest("hex");
const posted = await fetch(new URL("/api/stripe/webhook", url), {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "stripe-signature": `t=${stamp},v1=${mac}`,
  },
  body: payload,
});
if (posted.status !== 200) fail(`Webhook returned ${posted.status}. The signing secret must match .dev.vars.`);
const after = await readJson(
  await fetch(new URL(`/api/download?session_id=${encodeURIComponent(sessionId)}`, url)),
);
if (after.status !== 404) {
  fail(`After the simulated refund the download API returned ${after.status}, expected 404.`);
}
console.log("Simulated refund blocked another download. Also refund the payment in the Stripe test dashboard and confirm stripe listen delivers the real event.");
