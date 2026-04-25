
-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  vehicle_label TEXT,
  emergency_contact TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all_authed" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Live vehicle positions (one row per user, upsert)
CREATE TABLE public.vehicle_positions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed_kmh DOUBLE PRECISION NOT NULL DEFAULT 0,
  heading DOUBLE PRECISION NOT NULL DEFAULT 0,
  accuracy DOUBLE PRECISION,
  label TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vehicle_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "positions_select_all_authed" ON public.vehicle_positions FOR SELECT TO authenticated USING (true);
CREATE POLICY "positions_upsert_own" ON public.vehicle_positions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "positions_update_own" ON public.vehicle_positions FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "positions_delete_own" ON public.vehicle_positions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Incidents (sudden brake / crash / collision warning / SOS)
CREATE TYPE public.incident_type AS ENUM ('sudden_brake','collision_risk','crash','overspeed','sos');
CREATE TABLE public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.incident_type NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  speed_kmh DOUBLE PRECISION,
  severity INTEGER NOT NULL DEFAULT 1,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incidents_select_all_authed" ON public.incidents FOR SELECT TO authenticated USING (true);
CREATE POLICY "incidents_insert_own" ON public.incidents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Accident-prone zones (seedable, public read)
CREATE TABLE public.accident_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  radius_m INTEGER NOT NULL DEFAULT 250,
  risk_level INTEGER NOT NULL DEFAULT 2,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.accident_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zones_select_all" ON public.accident_zones FOR SELECT TO anon, authenticated USING (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicle_positions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.incidents;
ALTER TABLE public.vehicle_positions REPLICA IDENTITY FULL;
ALTER TABLE public.incidents REPLICA IDENTITY FULL;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed a few demo zones (around 0,0 — will be replaced when users explore)
INSERT INTO public.accident_zones (name, lat, lng, radius_m, risk_level, reason) VALUES
  ('Demo Sharp Turn', 12.9716, 77.5946, 300, 3, 'Reported sharp curve with low visibility'),
  ('Demo Busy Intersection', 28.6139, 77.2090, 400, 3, 'High-traffic intersection'),
  ('Demo Black Spot', 19.0760, 72.8777, 250, 2, 'Recurring rear-end collisions');
