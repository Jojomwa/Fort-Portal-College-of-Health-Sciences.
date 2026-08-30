// supabase/functions/send-push/index.ts
//
// Sends a real Web Push notification to every subscription on file for a
// student. Call this right after inserting a row into `notifications`
// (see the client's dbInsertNotification) — either directly from the
// client with the student's own JWT, or from a DB webhook/trigger using
// the service role key.
//
// Required secrets (set with: supabase secrets set KEY=value):
//   VAPID_PUBLIC_KEY   - same value as ACMIS_VAPID_PUBLIC_KEY in index.html
//   VAPID_PRIVATE_KEY  - the matching private key (never ships to the client)
//   VAPID_SUBJECT      - a mailto: or https: contact URL, e.g. mailto:admin@fortportalchs.ac.ug

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    // Accept either a raw payload {student_reg, subject, body, url} or a
    // Supabase DB-webhook payload ({ record: {...} }) for the notifications table.
    const record = body.record || body;
    const studentReg = record.student_reg;
    const subject = record.subject || "ACMIS";
    const messageBody = record.body || "";
    const url = record.url || "/";

    if (!studentReg) {
      return new Response(JSON.stringify({ error: "student_reg is required" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: subs, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("student_reg", studentReg);

    if (error) throw error;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, note: "no subscriptions for this student" }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({ subject, body: messageBody, url });
    const staleEndpoints: string[] = [];

    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          payload
        )
      )
    );

    results.forEach((r, i) => {
      // 404/410 means the browser has unsubscribed or the subscription
      // expired — clean those rows out so future sends don't keep failing.
      if (r.status === "rejected") {
        const statusCode = r.reason && (r.reason.statusCode || r.reason.status);
        if (statusCode === 404 || statusCode === 410) {
          staleEndpoints.push(subs[i].endpoint);
        } else {
          console.warn("push send failed:", r.reason);
        }
      }
    });

    if (staleEndpoints.length > 0) {
      await supabase.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
    }

    const sent = results.filter((r) => r.status === "fulfilled").length;
    return new Response(JSON.stringify({ sent, removed: staleEndpoints.length }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("send-push error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
