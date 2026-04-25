// Geolocation tracking + DeviceMotion-based brake/crash detection
import { useEffect, useRef, useState } from "react";

export interface Telemetry {
  lat: number;
  lng: number;
  speed_kmh: number;
  heading: number;
  accuracy?: number;
  ts: number;
}

export interface MotionEvent {
  kind: "sudden_brake" | "crash";
  magnitude: number;
  ts: number;
}

interface Options {
  onMotion?: (e: MotionEvent) => void;
  enabled: boolean;
}

export function useTelemetry({ onMotion, enabled }: Options) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [motionPermitted, setMotionPermitted] = useState<boolean>(true);
  const lastSpeedRef = useRef<number>(0);
  const lastTsRef = useRef<number>(Date.now());
  const watchIdRef = useRef<number | null>(null);

  // Geolocation
  useEffect(() => {
    if (!enabled) return;
    if (!("geolocation" in navigator)) {
      setError("Geolocation not supported on this device.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const speedMs = pos.coords.speed ?? 0;
        const speed_kmh = Math.max(0, (speedMs || 0) * 3.6);
        const t: Telemetry = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed_kmh,
          heading: pos.coords.heading ?? 0,
          accuracy: pos.coords.accuracy,
          ts: pos.timestamp,
        };
        // Sudden brake = large drop in speed quickly (geolocation-based fallback)
        const dt = (pos.timestamp - lastTsRef.current) / 1000;
        if (dt > 0 && dt < 3) {
          const drop = lastSpeedRef.current - speed_kmh;
          if (lastSpeedRef.current > 25 && drop / dt > 18) {
            onMotion?.({ kind: "sudden_brake", magnitude: drop / dt, ts: pos.timestamp });
          }
        }
        lastSpeedRef.current = speed_kmh;
        lastTsRef.current = pos.timestamp;
        setTelemetry(t);
        setError(null);
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
    watchIdRef.current = id;
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [enabled, onMotion]);

  // DeviceMotion for crash + brake detection
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
      // Crash: very high G spike
      if (mag > 35) {
        onMotion?.({ kind: "crash", magnitude: mag, ts: Date.now() });
      } else if (mag > 22) {
        onMotion?.({ kind: "sudden_brake", magnitude: mag, ts: Date.now() });
      }
    };
    // iOS requires permission
    const anyDM = (DeviceMotionEvent as any);
    if (typeof anyDM?.requestPermission === "function") {
      anyDM
        .requestPermission()
        .then((res: string) => {
          if (res === "granted") {
            window.addEventListener("devicemotion", handler);
            setMotionPermitted(true);
          } else {
            setMotionPermitted(false);
          }
        })
        .catch(() => setMotionPermitted(false));
    } else {
      window.addEventListener("devicemotion", handler);
    }
    return () => window.removeEventListener("devicemotion", handler);
  }, [enabled, onMotion]);

  return { telemetry, error, motionPermitted };
}

// Haversine in meters
export function distMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Closing-speed-based collision risk score 0-100 between self and another vehicle.
export function collisionRisk(
  self: { lat: number; lng: number; speed_kmh: number; heading: number },
  other: { lat: number; lng: number; speed_kmh: number; heading: number },
) {
  const d = distMeters(self, other); // meters
  if (d > 300) return 0;
  // Heading delta (0 = same direction, 180 = head-on)
  const hd = Math.abs(((self.heading - other.heading + 540) % 360) - 180);
  // Crude closing speed assumption based on heading delta and speeds
  const headOnFactor = 1 - Math.cos((hd * Math.PI) / 180); // 0..2
  const closingKmh = (self.speed_kmh + other.speed_kmh) * (headOnFactor / 2 + 0.2);
  if (closingKmh < 5) return 0;
  // Time to collision (s)
  const ttc = d / Math.max(1, (closingKmh * 1000) / 3600);
  if (ttc > 15) return Math.max(0, 20 - d / 30);
  if (ttc > 8) return 40;
  if (ttc > 4) return 70;
  return 95;
}
