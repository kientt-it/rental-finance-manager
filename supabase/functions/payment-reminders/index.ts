import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
type Settings = {
  property_id: string; organization_id: string; enabled: boolean; email_enabled: boolean; in_app_enabled: boolean;
  sender_name: string; sender_email: string; reply_to: string; email_subject_template: string; email_body_template: string;
};
type Candidate = {
  organization_id: string; property_id: string; period_start: string; due_date: string; member_id: string; auth_user_id: string;
  member_name: string; recipient_email: string; amount: number; items: string; reminder_type: "before" | "due" | "overdue";
  in_app_enabled: boolean; email_enabled: boolean;
};
type Event = Candidate & { id: string; email_status: string; attempt_count: number };
function fill(template: string, values: Record<string, string>) { return Object.entries(values).reduce((result, [key, value]) => result.replaceAll("{{" + key + "}}", value), template); }
function text(value: unknown) { return String(value ?? ""); }
function mailValues(row: { member_name: string; items: string; period_start: string; amount: number; due_date: string }) {
  const period = new Date(row.period_start + "T00:00:00Z").toLocaleDateString("vi-VN", { month: "2-digit", year: "numeric", timeZone: "UTC" });
  const dueDate = new Date(row.due_date + "T00:00:00Z").toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
  return { name: text(row.member_name), items: text(row.items), period, amount: new Intl.NumberFormat("vi-VN").format(Number(row.amount)) + " đ", due_date: dueDate };
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;
async function gmailAccessToken() {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken.value;
  const clientId = Deno.env.get("GMAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("GMAIL_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Chưa cấu hình GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET và GMAIL_REFRESH_TOKEN trong Supabase Edge Function Secrets.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const result = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error_description || result.error || "Không lấy được quyền truy cập Gmail API. Hãy kiểm tra OAuth credentials và refresh token.");
  cachedAccessToken = { value: result.access_token, expiresAt: Date.now() + (Number(result.expires_in) || 3600) * 1000 };
  return result.access_token;
}
function base64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
function encodedHeader(value: string) { return "=?UTF-8?B?" + base64Utf8(value.replace(/[\r\n]+/g, " ")) + "?="; }
function validEmail(value: string) { return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value); }
async function sendEmail(settings: Settings, to: string, subjectTemplate: string, bodyTemplate: string, row: { member_name: string; items: string; period_start: string; amount: number; due_date: string }) {
  if (!settings.sender_email || !settings.sender_name) throw new Error("Chưa cấu hình tên và email người gửi.");
  const senderEmail = Deno.env.get("GMAIL_SENDER_EMAIL");
  if (!senderEmail || !validEmail(senderEmail)) throw new Error("Chưa cấu hình GMAIL_SENDER_EMAIL hợp lệ trong Supabase Edge Function Secrets.");
  if (settings.sender_email.trim().toLowerCase() !== senderEmail.trim().toLowerCase()) throw new Error("Email gửi trong cấu hình phải trùng với GMAIL_SENDER_EMAIL đã xác thực qua Google OAuth.");
  if (!validEmail(to)) throw new Error("Địa chỉ email người nhận không hợp lệ.");
  if (settings.reply_to && !validEmail(settings.reply_to.trim())) throw new Error("Email nhận phản hồi chưa đúng định dạng.");
  const values = mailValues(row);
  const subject = fill(subjectTemplate, values).slice(0, 180).replace(/[\r\n]+/g, " ");
  const content = fill(bodyTemplate, values).slice(0, 5000);
  const contentBase64 = base64Utf8(content).replace(/.{1,76}/g, "$&\r\n").trimEnd();
  const mime = [
    "From: " + encodedHeader(settings.sender_name) + " <" + senderEmail + ">",
    "To: " + to.trim(),
    ...(settings.reply_to ? ["Reply-To: " + settings.reply_to.trim()] : []),
    "Subject: " + encodedHeader(subject),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    contentBase64,
  ].join("\r\n");
  const raw = btoa(mime).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: "Bearer " + await gmailAccessToken(), "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const result = await response.json().catch(() => ({})) as { error?: { message?: string }; id?: string };
  if (!response.ok) throw new Error(result.error?.message || "Gmail API không gửi được email.");
  return result;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json(500, { error: "Thiếu cấu hình Supabase cho Edge Function." });
  const body = await request.json().catch(() => ({}));
  const action = text((body as { action?: string }).action);
  const cronSecret = Deno.env.get("REMINDER_CRON_SECRET");
  const isCron = Boolean(cronSecret && request.headers.get("x-cron-secret") === cronSecret);
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  if (action === "test") {
    const authorization = request.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userResult, error: authError } = await userClient.auth.getUser();
    const user = userResult.user;
    if (authError || !user) return json(401, { error: "Hãy đăng nhập lại để gửi email thử." });
    const propertyId = text((body as { property_id?: string }).property_id);
    const { data: membership } = await userClient.from("members").select("organization_id").eq("user_id", user.id).eq("role", "admin").limit(1).maybeSingle();
    if (!membership) return json(403, { error: "Chỉ quản trị viên mới được gửi email thử." });
    const { data: settings, error: settingsError } = await userClient.from("payment_reminder_settings").select("*").eq("property_id", propertyId).eq("organization_id", membership.organization_id).maybeSingle();
    if (settingsError || !settings) return json(400, { error: "Hãy lưu cấu hình email trước khi gửi thử." });
    if (!user.email) return json(400, { error: "Tài khoản quản trị chưa có email nhận." });
    try {
      const sample = { member_name: user.user_metadata?.full_name || "Quản trị viên", items: "Tiền nhà và sinh hoạt", period_start: new Date().toISOString().slice(0, 7) + "-01", amount: 3600000, due_date: new Date().toISOString().slice(0, 10) };
      await sendEmail(settings as Settings, user.email, settings.email_subject_template, settings.email_body_template, sample);
      return json(200, { ok: true });
    } catch (error) { return json(502, { error: error instanceof Error ? error.message : "Gửi email thử thất bại." }); }
  }

  if (action !== "run" || !isCron) return json(401, { error: "Unauthorized" });
  const { data: candidates, error: candidateError } = await service.rpc("get_payment_reminder_candidates");
  if (candidateError) return json(500, { error: candidateError.message });
  const rows = (candidates ?? []) as Candidate[];
  const eventRows = rows.map((row) => ({
    organization_id: row.organization_id, property_id: row.property_id, period_start: row.period_start, due_date: row.due_date,
    member_id: row.member_id, auth_user_id: row.auth_user_id, member_name: row.member_name, recipient_email: row.recipient_email,
    amount: Math.round(Number(row.amount)), items: row.items, reminder_type: row.reminder_type, in_app_enabled: row.in_app_enabled,
    email_status: row.email_enabled ? "pending" : "skipped",
  }));
  if (eventRows.length) {
    const { error: insertError } = await service.from("payment_reminder_events").upsert(eventRows, { onConflict: "property_id,member_id,period_start,due_date,reminder_type", ignoreDuplicates: true });
    if (insertError) return json(500, { error: insertError.message });
  }
  const { data: settingsRows, error: settingsError } = await service.from("payment_reminder_settings").select("*").eq("enabled", true).eq("email_enabled", true);
  if (settingsError) return json(500, { error: settingsError.message });
  const settingsByProperty = new Map(((settingsRows ?? []) as Settings[]).map((setting) => [setting.property_id, setting]));
  const { data: retryRows, error: retryError } = await service.from("payment_reminder_events").select("*").in("email_status", ["pending", "failed"]).lt("attempt_count", 3).order("created_at").limit(100);
  if (retryError) return json(500, { error: retryError.message });
  let sent = 0; let failed = 0; let skipped = 0;
  for (const event of (retryRows ?? []) as Event[]) {
    const setting = settingsByProperty.get(event.property_id);
    if (!setting) { await service.from("payment_reminder_events").update({ email_status: "skipped", email_error: null }).eq("id", event.id); skipped++; continue; }
    const attempt = Number(event.attempt_count) + 1;
    try {
      await sendEmail(setting, event.recipient_email, setting.email_subject_template, setting.email_body_template, event);
      await service.from("payment_reminder_events").update({ email_status: "sent", email_error: null, attempt_count: attempt, sent_at: new Date().toISOString() }).eq("id", event.id);
      sent++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : "Gửi email thất bại.").slice(0, 500);
      await service.from("payment_reminder_events").update({ email_status: "failed", email_error: message, attempt_count: attempt }).eq("id", event.id);
      failed++;
    }
  }
  return json(200, { ok: true, candidates: rows.length, sent, failed, skipped });
});
