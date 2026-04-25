import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Shield, Radar, MapPin, AlertTriangle, Zap, Brain } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const features = [
  { icon: Radar, title: "Real-time collision alerts", desc: "Heads-up warnings when nearby vehicles are on a closing trajectory." },
  { icon: MapPin, title: "Live vehicle map", desc: "See nearby drivers, their direction, and speed in real time." },
  { icon: Zap, title: "Brake & overspeed detection", desc: "Sudden brake events broadcast to vehicles behind you." },
  { icon: AlertTriangle, title: "Accident-prone zones", desc: "Get notified when entering known black spots and busy junctions." },
  { icon: Shield, title: "Crash auto-SOS", desc: "Detected crashes trigger an instant alert to nearby drivers and your contact." },
  { icon: Brain, title: "AI safety co-pilot", desc: "Lovable AI (Gemini) scores live risk and suggests calm corrective actions." },
];

export default function Index() {
  const { user } = useAuth();
  return (
    <main className="min-h-full">
      <header className="container py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-xl bg-primary text-primary-foreground grid place-items-center font-black">SD</div>
          <div>
            <div className="font-semibold tracking-tight">SafeDrive V2V</div>
            <div className="text-xs text-muted-foreground">Vehicle-to-vehicle safety network</div>
          </div>
        </div>
        <nav className="flex gap-2">
          {user ? (
            <Button asChild><Link to="/drive">Open dashboard</Link></Button>
          ) : (
            <>
              <Button variant="ghost" asChild><Link to="/auth">Sign in</Link></Button>
              <Button asChild><Link to="/auth">Get started</Link></Button>
            </>
          )}
        </nav>
      </header>

      <section className="container py-16 md:py-24 grid gap-10 md:grid-cols-2 items-center">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-safe animate-pulse" /> Live network active
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            Stop accidents <span className="bg-gradient-to-r from-primary to-destructive bg-clip-text text-transparent">before</span> they happen.
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl">
            SafeDrive turns every phone into a V2V safety beacon. Nearby drivers warn each other in real time —
            collision risk, sudden brakes, accident zones, and crashes — powered by an AI co-pilot.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link to={user ? "/drive" : "/auth"}>Start driving safely</Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <a href="#features">See features</a>
            </Button>
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-6 bg-[var(--gradient-amber)] opacity-20 blur-3xl rounded-full" aria-hidden />
          <div className="relative rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-elevated)]">
            <div className="text-xs text-muted-foreground">LIVE RISK</div>
            <div className="text-6xl font-bold text-mono mt-1">23</div>
            <div className="text-sm text-safe mt-2">All clear • maintain following distance</div>
            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-secondary p-3">
                <div className="text-xs text-muted-foreground">Speed</div>
                <div className="text-xl font-semibold text-mono">48</div>
              </div>
              <div className="rounded-lg bg-secondary p-3">
                <div className="text-xs text-muted-foreground">Nearby</div>
                <div className="text-xl font-semibold text-mono">7</div>
              </div>
              <div className="rounded-lg bg-secondary p-3">
                <div className="text-xs text-muted-foreground">Zones</div>
                <div className="text-xl font-semibold text-mono">1</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="container py-16 grid gap-6 md:grid-cols-3">
        {features.map((f) => (
          <article key={f.title} className="rounded-xl border border-border bg-card p-6">
            <f.icon className="size-6 text-primary" />
            <h3 className="mt-4 font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
          </article>
        ))}
      </section>

      <footer className="container py-10 text-xs text-muted-foreground">
        Built with Lovable Cloud + Lovable AI. Prototype only — not a substitute for safe driving.
      </footer>
    </main>
  );
}
