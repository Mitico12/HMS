import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS Preflight request
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Verify User Authentication via Supabase JWT
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase environment variables not configured.");
    }
    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY is not configured in Supabase secrets.");
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

    // 2. Parse User Prompt
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Missing or invalid prompt" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Set up Invisible System Instructions for Gemini (conversational + checklist dual schema)
    const systemInstruction = `You are the HMS Assistant, an AI helper for the Nicosoft HMS Admin Console.
Users can chat with you, ask questions, or ask you to create checklists.
You must always respond strictly in valid JSON format. The JSON schema must be exactly:
{
  "response": "Your markdown-formatted text response to the user. Explain details, answer questions, or introduce the checklist.",
  "checklist": null // Or the generated checklist object if they asked to create one
}

A checklist object must strictly have this schema:
{
  "title": "A descriptive title for the checklist",
  "items": [
    {
      "label": "The check item description (clear, concise, actionable, in English or Norwegian depending on prompt language)",
      "type": "check" | "choice" | "number" | "text",
      "options": ["Option 1", "Option 2"], // Array of strings. ONLY allowed/required when type is 'choice'. Use standard options like ["Yes", "No"] or ["OK", "Not OK"].
      "expectedValues": ["OK", "Yes"], // Array of strings. Optional passing values for choice or text items.
      "expectedMin": 10, // Number. Optional minimum passing number for number items.
      "expectedMax": 100, // Number. Optional maximum passing number for number items.
      "fixOnNo": true // Boolean. Optional. Set to true if selecting 'No' or a negative option should require corrective action.
    }
  ]
}

Only return the raw JSON object, no markdown wrappers, no backticks (like \`\`\`json), just pure JSON.`;

    // 4. Request Gemini API (Using cheapest model: gemini-2.5-flash)
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
