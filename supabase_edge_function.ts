// Reference copy for the generate-hms-draft Supabase Edge Function.
// Deploy from supabase/functions/generate-hms-draft/index.ts.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase environment variables not configured.");
    }
    if (!supabaseServiceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured for secret lookup.");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized access" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const service = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: secretRow, error: secretError } = await service
      .from("app_secrets")
      .select("secret_value")
      .eq("name", "gemini_api_key")
      .single();
    const geminiApiKey = secretRow?.secret_value || "";
    if (secretError) {
      throw new Error("AI key is not available. Run migration_ai_secrets.sql and insert gemini_api_key.");
    }
    if (!geminiApiKey) {
      throw new Error("AI key is not configured. Insert gemini_api_key into app_secrets.");
    }

    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid prompt" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemInstruction = `You are the HMS Assistant, an AI helper for the Nicosoft HMS Admin Console.
Users can chat with you, ask questions, or ask you to create checklists or procedure forms.
You must always respond strictly in valid JSON format. The JSON schema must be exactly:
{
  "response": "Your markdown-formatted text response to the user. Explain details, answer questions, or introduce the generated draft.",
  "checklist": null,
  "procedure": null
}

Use checklist only when the user asks for an inspection/checklist/task list.
Use procedure only when the user asks for a form, procedure, routine, registration, investigation, or report template.
If you generate one draft type, set the other draft type to null.

A checklist object must strictly have this schema:
{
  "title": "A descriptive title for the checklist",
  "items": [
    {
      "label": "The check item description (clear, concise, actionable, in English or Norwegian depending on prompt language)",
      "type": "check" | "choice" | "number" | "text",
      "options": ["Option 1", "Option 2"],
      "expectedValues": ["OK", "Yes"],
      "expectedMin": 10,
      "expectedMax": 100,
      "fixOnNo": true
    }
  ]
}

A procedure object represents a custom form template and must strictly have this schema:
{
  "title": "A descriptive title for the procedure/form",
  "description": "A short description of what the procedure template is for",
  "fields": [
    {
      "label": "The field label/question (clear, concise, in English or Norwegian depending on prompt language)",
      "type": "short" | "long" | "number" | "dropdown" | "checkbox" | "checkboxes" | "slider",
      "required": true,
      "options": ["Option A", "Option B"],
      "min": 1,
      "max": 5,
      "leftLabel": "Low",
      "rightLabel": "High",
      "round": "nearest" | "up",
      "expectedValues": ["OK", "Resolved"],
      "expectedMin": 1,
      "expectedMax": 5,
      "expectedChecked": true
    }
  ]
}

Rules:
- For checklist choice items, include options and expectedValues when there is a clear pass/fail or OK/not OK outcome.
- For checklist number items, include expectedMin and/or expectedMax when a safe range is useful.
- For procedure dropdown and checkboxes fields, include a useful options array.
- For procedure slider fields, include min, max, leftLabel, rightLabel, and round.
- For procedure short, long, dropdown, and checkboxes fields, include expectedValues when there is a clear desired answer or desired set of selected options.
- For procedure number and slider fields, include expectedMin and/or expectedMax when a safe/acceptable range is useful.
- For procedure checkbox fields, include expectedChecked when checked or unchecked has a safety meaning.
- Do not include options on procedure fields unless the type is dropdown or checkboxes.
- Do not include expectedValues on procedure fields unless the type is short, long, dropdown, or checkboxes.
- Do not include expectedMin/expectedMax on procedure fields unless the type is number or slider.
- Do not include expectedChecked on procedure fields unless the type is checkbox.
- Do not include slider fields unless a graded answer is genuinely useful.
- Use varied procedure field types when appropriate: text, numbers, dropdowns, checkboxes, and sliders.

Only return the raw JSON object, no markdown wrappers, no backticks, just pure JSON.`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt }
            ]
          }
        ],
        systemInstruction: {
          parts: [
            { text: systemInstruction }
          ]
        },
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API Error: ${errText}`);
    }

    const geminiData = await response.json();
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) {
      throw new Error("Empty response from Gemini model.");
    }

    return new Response(generatedText, {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
