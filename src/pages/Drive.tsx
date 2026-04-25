import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { collisionRisk, distMeters, useTelemetry } from "@/hooks/useTelemetry";
import { alertPattern } from "@/lib/alerts";
import LiveMap, { MapVehicle, MapZone } from "@/components/LiveMap";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, Gauge, LogOut, Radar, Shield, ShieldAlert, Siren } from "lucide-react";

interface VehicleRow {
  user_id: string;
  lat: number;
  lng: number;
  speed_kmh: number;
  heading: number;
  label: string | null;
  updated_at: string;
}
interface IncidentRow {
  id: string;
  user_id: string | null;
  kind: "sudden_brake" | "collision_risk" | "crash" | "overspeed" | "sos";
  lat: number;
  lng: number;
  speed_kmh: number | null;
  message: string | null;
  created_at: string;
}

const SPEED_LIMIT_KMH = 80;

export default function Drive() {
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [tracking, setTracking] = useState(true);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [zones, setZones] = useState<MapZone[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [risk, setRisk] = useState<{
    risk_score: number;
    level: "safe" | "caution" | "danger" | "critical";
    warning: string;
    actions: string[];
    reasons: string[];
  } | null>(null);
  const [profileLabel, setProfileLabel] = useState<string>("My vehicle");
  const lastUploadRef = useRef<number>(0);
  const lastAiRef = useRef<number>(0);
  const lastZoneAlertRef = useRef<Record<string, number>>({});

  // Redirect unauthenticated
  useEffect(() => {
    if (!authLoading && !user) nav("/auth", { replace: true });
  }, [authLoading, user, nav]);

  // Load profile label
  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("display_name, vehicle_label").eq("id", user.id).maybeSingle().then(({ data }) => {
      if (data) setProfileLabel(data.vehicle_label || data.display_name || "My vehicle");
    });
  }, [user]);

  // Load zones once
  useEffect(() => {
    supabase.from("accident_zones").select("*").then(({ data }) => {
      if (data) setZones(data as any);
    });
  }, []);

  // Load + subscribe to other vehicle positions
  useEffect(() => {
    if (!user) return;
    let mounted = true;

    const refresh = async () => {
      const { data } = await supabase.from("vehicle_positions").select("*");
      if (mounted && data) setVehicles(data as any);
    };
    refresh();

    const channel = supabase
      .channel("rt-positions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "vehicle_positions" },
        (payload: any) => {
          setVehicles((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((v) => v.user_id !== payload.old.user_id);
            }
            const row = payload.new as VehicleRow;
            const idx = prev.findIndex((v) => v.user_id === row.user_id);
            if (idx === -1) return [...prev, row];
            const next = [...prev];
            next[idx] = row;
            return next;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "incidents" },
        (payload: any) => {
          const row = payload.new as IncidentRow;
          setIncidents((prev) => [row, ...prev].slice(0, 30));
          // Toast nearby incidents from others
          if (row.user_id && row.user_id !== user.id) {
            toast.warning(`${labelForKind(row.kind)} reported nearby`, {
              description: row.message ?? undefined,
            });
          }
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const onMotion = useCallback(
    async (e: { kind: "sudden_brake" | "crash"; magnitude: number; ts: number }) => {
      if (!user || !telemetryRef.current) return;
      const t = telemetryRef.current;
      const message =
        e.kind === "crash"
          ? `Possible crash detected (impact ${e.magnitude.toFixed(1)}g)`
          : `Sudden brake at ${Math.round(t.speed_kmh)} km/h`;
      await supabase.from("incidents").insert({
        user_id: user.id,
        kind: e.kind,
        lat: t.lat,
        lng: t.lng,
        speed_kmh: t.speed_kmh,
        severity: e.kind === "crash" ? 3 : 2,
        message,
      });
      alertPattern(e.kind === "crash" ? "critical" : "danger");
      toast.error(message);
    },
    [user],
  );

  const { telemetry, error, motionPermitted } = useTelemetry({
    enabled: tracking && !!user,
    onMotion,
  });

  // keep ref for callbacks
  const telemetryRef = useRef(telemetry);
  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);

  // Throttled upsert of position (every ~1.5s)
  useEffect(() => {
    if (!user || !telemetry) return;
    const now = Date.now();
    if (now - lastUploadRef.current < 1500) return;
    lastUploadRef.current = now;
    supabase
      .from("vehicle_positions")
      .upsert({
        user_id: user.id,
        lat: telemetry.lat,
        lng: telemetry.lng,
        speed_kmh: telemetry.speed_kmh,
        heading: telemetry.heading,
        accuracy: telemetry.accuracy,
        label: profileLabel,
        updated_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error) console.error("position upsert", error.message);
      });
  }, [telemetry, user, profileLabel]);

  // Compute nearby vehicles + risk per vehicle
  const { nearby, maxRisk, vehiclesWithRisk } = useMemo(() => {
    if (!telemetry) return { nearby: [] as VehicleRow[], maxRisk: 0, vehiclesWithRisk: [] as MapVehicle[] };
    const others = vehicles.filter((v) => user && v.user_id !== user.id);
    const enriched = others.map((o) => {
      const r = collisionRisk(
        { lat: telemetry.lat, lng: telemetry.lng, speed_kmh: telemetry.speed_kmh, heading: telemetry.heading },
        { lat: o.lat, lng: o.lng, speed_kmh: o.speed_kmh, heading: o.heading },
      );
      return { ...o, risk: r };
    });
    const close = enriched.filter((o) => distMeters(telemetry, o) < 1500);
    const max = enriched.reduce((m, v) => Math.max(m, v.risk), 0);
    const mapped: MapVehicle[] = enriched.map((v) => ({
      user_id: v.user_id,
      lat: v.lat,
      lng: v.lng,
      heading: v.heading,
      speed_kmh: v.speed_kmh,
      label: v.label,
      risk: v.risk,
    }));
    return { nearby: close, maxRisk: max, vehiclesWithRisk: mapped };
  }, [vehicles, telemetry, user]);

  // Trigger alert tones when local risk crosses thresholds
  const lastLocalLevelRef = useRef<string>("safe");
  useEffect(() => {
    let level: "safe" | "caution" | "danger" | "critical" = "safe";
    if (maxRisk >= 80) level = "critical";
    else if (maxRisk >= 60) level = "danger";
    else if (maxRisk >= 35) level = "caution";
    if (level !== lastLocalLevelRef.current && level !== "safe") {
      alertPattern(level === "critical" ? "critical" : level === "danger" ? "danger" : "caution");
      // Persist a collision-risk incident only when it's serious
      if (user && telemetry && level !== "caution") {
        supabase.from("incidents").insert({
          user_id: user.id,
          kind: "collision_risk",
          lat: telemetry.lat,
          lng: telemetry.lng,
          speed_kmh: telemetry.speed_kmh,
          severity: level === "critical" ? 3 : 2,
          message: `Collision risk ${Math.round(maxRisk)} with nearby vehicle`,
        });
      }
    }
    lastLocalLevelRef.current = level;
  }, [maxRisk, telemetry, user]);

  // Overspeed
  useEffect(() => {
    if (!telemetry || !user) return;
    if (telemetry.speed_kmh > SPEED_LIMIT_KMH) {
      const k = "overspeed";
      const last = lastZoneAlertRef.current[k] ?? 0;
      if (Date.now() - last > 30000) {
        lastZoneAlertRef.current[k] = Date.now();
        toast.warning(`Overspeeding at ${Math.round(telemetry.speed_kmh)} km/h`);
        alertPattern("caution");
        supabase.from("incidents").insert({
          user_id: user.id,
          kind: "overspeed",
          lat: telemetry.lat,
          lng: telemetry.lng,
          speed_kmh: telemetry.speed_kmh,
          severity: 1,
          message: `Overspeeding at ${Math.round(telemetry.speed_kmh)} km/h (limit ${SPEED_LIMIT_KMH})`,
        });
      }
    }
  }, [telemetry, user]);

  // Zone proximity
  useEffect(() => {
    if (!telemetry) return;
    zones.forEach((z) => {
      const d = distMeters(telemetry, z);
      if (d <= z.radius_m) {
        const last = lastZoneAlertRef.current[z.id] ?? 0;
        if (Date.now() - last > 60000) {
          lastZoneAlertRef.current[z.id] = Date.now();
          toast.warning(`Entering ${z.name}`, { description: z.reason ?? "Accident-prone zone" });
          alertPattern(z.risk_level >= 3 ? "danger" : "caution");
        }
      }
    });
  }, [telemetry, zones]);

  // AI risk assessment every 10s when moving
  useEffect(() => {
    if (!telemetry) return;
    const now = Date.now();
    if (now - lastAiRef.current < 10000) return;
    if (telemetry.speed_kmh < 3 && nearby.length === 0) return;
    lastAiRef.current = now;

    const nearbyZones = zones
      .filter((z) => distMeters(telemetry, z) < z.radius_m + 800)
      .map((z) => ({ name: z.name, lat: z.lat, lng: z.lng, radius_m: z.radius_m, risk_level: z.risk_level, reason: z.reason }));
    const recent_brakes = incidents.filter(
      (i) => i.kind === "sudden_brake" && Date.now() - new Date(i.created_at).getTime() < 60000,
    ).length;

    supabase.functions
      .invoke("risk-agent", {
        body: {
          self: {
            user_id: user?.id ?? "self",
            lat: telemetry.lat,
            lng: telemetry.lng,
            speed_kmh: Math.round(telemetry.speed_kmh),
            heading: Math.round(telemetry.heading),
            label: profileLabel,
          },
          nearby: nearby.slice(0, 10).map((v) => ({
            user_id: v.user_id,
            lat: v.lat,
            lng: v.lng,
            speed_kmh: Math.round(v.speed_kmh),
            heading: Math.round(v.heading),
            label: v.label,
          })),
          zones: nearbyZones,
          recent_brakes,
        },
      })
      .then(({ data, error }) => {
        if (error) {
          console.error("risk-agent", error);
          return;
        }
        if (data && typeof data === "object" && "risk_score" in data) {
          setRisk(data as any);
        }
      });
  }, [telemetry, nearby, zones, incidents, user, profileLabel]);

  async function triggerSOS() {
    if (!user || !telemetry) {
      toast.error("Need GPS lock to send SOS");
      return;
    }
    await supabase.from("incidents").insert({
      user_id: user.id,
      kind: "sos",
      lat: telemetry.lat,
      lng: telemetry.lng,
      speed_kmh: telemetry.speed_kmh,
      severity: 3,
      message: "Manual SOS — driver requested emergency help",
    });
    alertPattern("critical");
    toast.error("SOS broadcast to nearby drivers");
  }

  async function signOut() {
    await supabase.auth.signOut();
    nav("/", { replace: true });
  }

  const level = risk?.level ?? (maxRisk >= 60 ? "danger" : maxRisk >= 35 ? "caution" : "safe");
  const score = risk?.risk_score ?? Math.round(maxRisk);

  return (
    <main className="h-full flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border bg-card/60 backdrop-blur px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-black text-sm">SD</div>
          <div>
            <div className="text-sm font-semibold">SafeDrive V2V</div>
            <div className="text-xs text-muted-foreground">{profileLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant={tracking ? "secondary" : "default"} onClick={() => setTracking((v) => !v)}>
            {tracking ? "Pause tracking" : "Start tracking"}
          </Button>
          <Button size="sm" variant="ghost" onClick={signOut} aria-label="Sign out">
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      {/* HUD strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3">
        <HudCard
          icon={<RiskIcon level={level} />}
          label="Live risk"
          value={`${score}`}
          accent={level === "critical" || level === "danger" ? "danger" : level === "caution" ? "amber" : "safe"}
          sub={risk?.warning ?? (level === "safe" ? "All clear" : "Stay alert")}
        />
        <HudCard
          icon={<Gauge className="size-5" />}
          label="Speed"
          value={telemetry ? `${Math.round(telemetry.speed_kmh)}` : "—"}
          sub="km/h"
          accent={telemetry && telemetry.speed_kmh > SPEED_LIMIT_KMH ? "danger" : "default"}
        />
        <HudCard
          icon={<Radar className="size-5" />}
          label="Nearby"
          value={`${nearby.length}`}
          sub="vehicles in 1.5 km"
          accent="default"
        />
        <HudCard
          icon={<AlertTriangle className="size-5" />}
          label="Zones"
          value={`${zones.filter((z) => telemetry && distMeters(telemetry, z) < z.radius_m + 500).length}`}
          sub="risky areas around"
          accent="default"
        />
      </section>

      {/* Map + side panel */}
      <section className="flex-1 grid lg:grid-cols-[1fr_360px] gap-3 px-3 pb-3 min-h-[480px]">
        <div className="rounded-xl overflow-hidden border border-border bg-card">
          <LiveMap
            self={
              telemetry && user
                ? {
                    user_id: user.id,
                    lat: telemetry.lat,
                    lng: telemetry.lng,
                    heading: telemetry.heading,
                    speed_kmh: telemetry.speed_kmh,
                    label: profileLabel,
                  }
                : null
            }
            vehicles={vehiclesWithRisk}
            zones={zones}
            follow={tracking}
          />
        </div>

        <aside className="space-y-3">
          {error && (
            <Card className="p-4 border-destructive/40 bg-destructive/10 text-sm">
              <strong>GPS error:</strong> {error}
            </Card>
          )}
          {!motionPermitted && (
            <Card className="p-4 text-sm">
              Motion sensor blocked. Brake & crash detection limited to GPS only.
            </Card>
          )}
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">AI co-pilot</h3>
              <Badge variant="secondary">Gemini</Badge>
            </div>
            {risk ? (
              <>
                <div className={`text-sm ${level === "critical" || level === "danger" ? "text-destructive" : level === "caution" ? "text-primary" : "text-safe"}`}>
                  {risk.warning}
                </div>
                <ul className="text-sm list-disc pl-5 space-y-1">
                  {risk.actions.slice(0, 3).map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                {risk.reasons?.length > 0 && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Why this score</summary>
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      {risk.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                Move with GPS active to receive live risk assessment.
              </div>
            )}
          </Card>

          <Button
            size="lg"
            variant="destructive"
            className="w-full h-14 text-base font-bold pulse-ring"
            onClick={triggerSOS}
          >
            <Siren className="size-5 mr-2" /> EMERGENCY SOS
          </Button>

          <Card className="p-4">
            <h3 className="font-semibold mb-2 text-sm">Recent network events</h3>
            <ul className="space-y-2 max-h-64 overflow-auto">
              {incidents.length === 0 && (
                <li className="text-xs text-muted-foreground">No incidents in your network yet.</li>
              )}
              {incidents.map((i) => (
                <li key={i.id} className="text-sm flex items-start gap-2">
                  <KindBadge kind={i.kind} />
                  <div>
                    <div>{i.message ?? labelForKind(i.kind)}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(i.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </section>
    </main>
  );
}

function labelForKind(k: IncidentRow["kind"]) {
  return {
    sudden_brake: "Sudden brake",
    collision_risk: "Collision risk",
    crash: "Crash",
    overspeed: "Overspeeding",
    sos: "Emergency SOS",
  }[k];
}

function KindBadge({ kind }: { kind: IncidentRow["kind"] }) {
  const map: Record<IncidentRow["kind"], string> = {
    crash: "bg-destructive text-destructive-foreground",
    sos: "bg-destructive text-destructive-foreground",
    collision_risk: "bg-primary text-primary-foreground",
    sudden_brake: "bg-primary text-primary-foreground",
    overspeed: "bg-info text-info-foreground",
  };
  return <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${map[kind]}`}>{labelForKind(kind)}</span>;
}

function RiskIcon({ level }: { level: "safe" | "caution" | "danger" | "critical" }) {
  if (level === "safe") return <Shield className="size-5 text-safe" />;
  if (level === "caution") return <AlertTriangle className="size-5 text-primary" />;
  return <ShieldAlert className="size-5 text-destructive" />;
}

function HudCard({
  icon, label, value, sub, accent = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: "default" | "amber" | "danger" | "safe";
}) {
  const accentCls =
    accent === "danger"
      ? "border-destructive/50 shadow-[var(--shadow-glow-danger)]"
      : accent === "amber"
        ? "border-primary/50 shadow-[var(--shadow-glow-amber)]"
        : accent === "safe"
          ? "border-safe/40"
          : "border-border";
  return (
    <Card className={`p-3 flex items-center gap-3 ${accentCls}`}>
      <div className="size-10 rounded-lg bg-secondary grid place-items-center">{icon}</div>
      <div className="flex-1">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold text-mono leading-none">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{sub}</div>}
      </div>
    </Card>
  );
}
