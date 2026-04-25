# SafeDrive V2V — Vehicle-to-vehicle accident reduction app

A real-time driver safety network. Every phone becomes a V2V beacon: drivers warn each other about
collision risk, sudden brakes, overspeeding, accident-prone zones, and crashes. An AI co-pilot
(Lovable AI / Google Gemini) scores live risk and suggests calm corrective actions.

> **Important**: This is a prototype. True V2V uses DSRC/C-V2X radio in vehicles. This app simulates
> V2V over the cloud using GPS positions shared between phones in real time.

## Features

1. **Real-time collision alerts** — closing-trajectory scoring with sound + vibration warnings.
2. **Live vehicle map** — Leaflet + OpenStreetMap, real-time positions of nearby drivers (Supabase Realtime).
3. **Speed & sudden brake detection** — GPS speed deltas + DeviceMotion accelerometer; broadcast to nearby drivers.
4. **Accident-prone zone alerts** — geo-fenced black spots, sharp turns, busy junctions.
5. **Crash auto-SOS** — high-G impact spike triggers an instant alert to nearby vehicles + manual SOS button.
6. **AI safety co-pilot** — `risk-agent` edge function calls Gemini via Lovable AI Gateway, returns a structured risk assessment (score, level, warning, actions).

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite + TypeScript + Tailwind + shadcn/ui |
| Map | Leaflet + react-leaflet + OpenStreetMap |
| Backend | Lovable Cloud (Supabase: Postgres, Auth, Realtime, Edge Functions) |
| AI | Lovable AI Gateway → `google/gemini-2.5-flash` (tool-calling for structured output) |

> Note: The user's brief asked for `FastAPI` + `Agno` (Python). Lovable runs React on the frontend
> and Deno-based Edge Functions on the backend, so the equivalent functionality is delivered with
> Edge Functions in TypeScript and the Lovable AI Gateway. The behavior — telemetry in, structured
> risk assessment out — matches an Agno-style agent.

## Project structure

```
src/
  pages/
    Index.tsx       # Landing
    Auth.tsx        # Email/password sign-up + sign-in
    Drive.tsx       # Live driving dashboard (map + HUD + AI + SOS)
  components/
    LiveMap.tsx     # Leaflet map with vehicles + zones
  hooks/
    useAuth.ts      # Supabase session hook
    useTelemetry.ts # GPS + DeviceMotion + collision math
  lib/
    alerts.ts       # WebAudio beep + vibration patterns
  integrations/supabase/   # Auto-generated client + types
supabase/
  functions/risk-agent/    # Lovable AI risk-assessment endpoint
  config.toml
```

## Database schema

- `profiles` (id, display_name, vehicle_label, emergency_contact)
- `vehicle_positions` (user_id PK, lat, lng, speed_kmh, heading, accuracy, label)
- `incidents` (id, user_id, kind enum: sudden_brake/collision_risk/crash/overspeed/sos, lat, lng, severity, message)
- `accident_zones` (id, name, lat, lng, radius_m, risk_level, reason)

All tables have Row-Level Security. Authenticated users can read all positions/incidents (needed
to warn nearby drivers) but can only write their own.

## How it runs in Lovable

This project is connected to **Lovable Cloud** — no setup needed:

- Database, Auth, Realtime, and Edge Functions are auto-provisioned.
- `LOVABLE_API_KEY` for the AI Gateway is auto-injected into edge functions.
- Press **Run** in Lovable to preview, **Publish** to ship.

To use the app:
1. Open the preview, sign up with email + password.
2. Go to **/drive** — grant **Location** permission.
3. On iOS Safari, also tap **Allow** for **Motion & Orientation** when prompted.
4. Open the app on a second device (or another browser tab + account) to see V2V alerts in action.

## Run locally (optional)

```sh
# Requires Node 18+ and bun (or npm)
bun install      # or: npm install
bun run dev      # or: npm run dev
```

Local runs need the Lovable Cloud env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`)
which Lovable injects automatically; copy them from the connected project's `.env` if you fork.

## AI endpoint

`POST /functions/v1/risk-agent`

Request body:
```json
{
  "self":   { "lat": 12.97, "lng": 77.59, "speed_kmh": 48, "heading": 90 },
  "nearby": [{ "lat": 12.971, "lng": 77.591, "speed_kmh": 60, "heading": 270 }],
  "zones":  [{ "name": "Sharp turn", "lat": 12.97, "lng": 77.59, "radius_m": 250, "risk_level": 3 }],
  "recent_brakes": 1
}
```

Response (structured via Gemini tool-calling):
```json
{
  "risk_score": 78,
  "level": "danger",
  "warning": "Vehicle approaching head-on at high closing speed.",
  "actions": ["Reduce speed", "Move to right lane", "Increase following distance"],
  "reasons": ["Closing trajectory", "Inside accident-prone zone"]
}
```

## Safety disclaimer

This app is an educational prototype. It is NOT a certified ADAS / V2V safety system. Do not rely
on it as a substitute for attentive driving, mirrors, or factory-installed safety hardware.
