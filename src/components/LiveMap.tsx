import { MapContainer, TileLayer, Marker, Circle, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, useMemo } from "react";

// Fix default Leaflet marker icons in bundled environments
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

function carIcon(color: string, heading = 0, isSelf = false) {
  const size = isSelf ? 36 : 28;
  const html = `<div style="transform: rotate(${heading}deg); width:${size}px; height:${size}px;">
    <svg viewBox="0 0 24 24" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="11" fill="${color}" stroke="white" stroke-width="1.5" />
      <path d="M12 4 L16 14 L12 11.5 L8 14 Z" fill="white" />
    </svg>
  </div>`;
  return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}

function Recenter({ lat, lng, follow }: { lat: number; lng: number; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (follow) map.setView([lat, lng], map.getZoom() < 14 ? 16 : map.getZoom(), { animate: true });
  }, [lat, lng, follow, map]);
  return null;
}

export interface MapVehicle {
  user_id: string;
  lat: number;
  lng: number;
  heading: number;
  speed_kmh: number;
  label?: string | null;
  risk?: number;
}
export interface MapZone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  risk_level: number;
  reason?: string | null;
}

interface Props {
  self?: MapVehicle | null;
  vehicles: MapVehicle[];
  zones: MapZone[];
  follow: boolean;
}

export default function LiveMap({ self, vehicles, zones, follow }: Props) {
  const center: [number, number] = self ? [self.lat, self.lng] : [20.5937, 78.9629];
  const zoneColor = (lvl: number) => (lvl >= 3 ? "#ef4444" : lvl === 2 ? "#f59e0b" : "#22d3ee");

  const others = useMemo(
    () => vehicles.filter((v) => !self || v.user_id !== self.user_id),
    [vehicles, self],
  );

  return (
    <MapContainer center={center} zoom={15} className="h-full w-full" zoomControl={true}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
      />
      {self && <Recenter lat={self.lat} lng={self.lng} follow={follow} />}

      {zones.map((z) => (
        <Circle
          key={z.id}
          center={[z.lat, z.lng]}
          radius={z.radius_m}
          pathOptions={{ color: zoneColor(z.risk_level), fillColor: zoneColor(z.risk_level), fillOpacity: 0.12, weight: 1 }}
        >
          <Popup>
            <strong>{z.name}</strong>
            <br />
            Risk: {z.risk_level}/3
            {z.reason && <><br />{z.reason}</>}
          </Popup>
        </Circle>
      ))}

      {others.map((v) => {
        const color = v.risk && v.risk > 70 ? "#ef4444" : v.risk && v.risk > 40 ? "#f59e0b" : "#22d3ee";
        return (
          <Marker key={v.user_id} position={[v.lat, v.lng]} icon={carIcon(color, v.heading)}>
            <Popup>
              <strong>{v.label || "Vehicle"}</strong>
              <br />
              Speed: {Math.round(v.speed_kmh)} km/h
              {typeof v.risk === "number" && (
                <>
                  <br />
                  Risk: {Math.round(v.risk)}
                </>
              )}
            </Popup>
          </Marker>
        );
      })}

      {self && (
        <Marker position={[self.lat, self.lng]} icon={carIcon("#f59e0b", self.heading, true)}>
          <Popup>
            <strong>You</strong>
            <br />
            Speed: {Math.round(self.speed_kmh)} km/h
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
