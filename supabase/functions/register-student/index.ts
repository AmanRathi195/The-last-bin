import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeStudentId(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

async function authEmailForId(studentId: string) {
  const input = new TextEncoder().encode(`the-last-bin:${studentId}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `student-${hex.slice(0, 48)}@accounts.thelastbin.app`;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const body = await request.json();
    const studentId = normalizeStudentId(body.uid ?? body.studentId);
    const fullName = String(body.fullName ?? "").trim();
    const department = String(body.department ?? "").trim();
    const password = String(body.password ?? body.pin ?? "");

    if (!/^[A-Z0-9._:/-]{3,80}$/.test(studentId)) {
      return json({ error: "Enter a valid UID." }, 400);
    }
    if (fullName.length < 2 || fullName.length > 120) {
      return json({ error: "Enter your full name." }, 400);
    }
    if (department.length < 2 || department.length > 120) {
      return json({ error: "Enter your department." }, 400);
    }
    if (password.length < 8 || password.length > 72) {
      return json({ error: "Create a password containing at least eight characters." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Server configuration is incomplete.");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = await authEmailForId(studentId);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, student_id: studentId, department },
    });

    if (error) {
      const duplicate = /already|registered|exists/i.test(error.message);
      return json(
        { error: duplicate ? "This UID is already registered. Sign in instead." : "Registration could not be completed." },
        duplicate ? 409 : 400,
      );
    }

    return json({ ok: true, userId: data.user.id }, 201);
  } catch (error) {
    console.error("register-student failed", error instanceof Error ? error.message : "Unknown error");
    return json({ error: "Registration service is temporarily unavailable." }, 500);
  }
});
