// Lovable AI risk-assessment agent (Gemini)
// Takes the driver's recent telemetry + nearby vehicles + zones,
// returns a plain-language risk assessment and recommended action.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Vehicle {
  user_id: string;
  lat: number;
  lng: number;
  speed_kmh: number;
  heading: number;
  label?: string | null;
}
interface Zone {
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  risk_level: number;
  reason?: string | null;
}
interface Payload {
  self: Vehicle;
  nearby: Vehicle[];
  zones: Zone[];
  recent_brakes?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as Payload;
    if (!body?.self) {
      return new Response(JSON.stringify({ error: "Missing self telemetry" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const system = `You are a driving safety co-pilot for a Vehicle-to-Vehicle warning app.
You receive live telemetry of the driver and nearby vehicles plus accident-prone zones.
Return a concise risk assessment with a numeric score (0-100), a one-sentence warning suitable for a heads-up display, and 1-3 short recommended actions. Be calm and direct. Never invent vehicles you weren't given.`;

    const user = `My telemetry: ${JSON.stringify(body.self)}
Nearby vehicles (${body.nearby?.length ?? 0}): ${JSON.stringify(body.nearby ?? [])}
Accident zones within range: ${JSON.stringify(body.zones ?? [])}
Recent sudden brakes around me: ${body.recent_brakes ?? 0}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "report_risk",
              description: "Report driving risk assessment",
              parameters: {
                type: "object",
                properties: {
                  risk_score: { type: "number", description: "0-100" },
                  level: { type: "string", enum: ["safe", "caution", "danger", "critical"] },
                  warning: { type: "string", description: "One short HUD-friendly sentence" },
                  actions: {
                    type: "array",
                    items: { type: "string" },
                    description: "1-3 short recommended actions",
                  },
                  reasons: {
                    type: "array",
                    items: { type: "string" },
                    description: "Why this score (short bullets)",
                  },
                },
                required: ["risk_score", "level", "warning", "actions", "reasons"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "report_risk" } },
      }),
    });

    if (!aiRes.ok) {
      const text = await aiRes.text();
      console.error("AI gateway error", aiRes.status, text);
      if (aiRes.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited. Please slow down requests." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiRes.status === 402) {
        return new Response(
          JSON.stringify({
            error: "Lovable AI credits exhausted. Add credits in workspace settings.",
          }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiRes.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any = null;
    if (tc?.function?.arguments) {
      try {
        parsed = JSON.parse(tc.function.arguments);
      } catch (_) {
        parsed = null;
      }
    }
    if (!parsed) {
      parsed = {
        risk_score: 0,
        level: "safe",
        warning: "All clear.",
        actions: ["Maintain safe distance"],
        reasons: ["No structured response from model"],
      };
    }

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("risk-agent error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
