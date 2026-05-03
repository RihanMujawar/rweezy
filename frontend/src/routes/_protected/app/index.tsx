import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { UtensilsCrossed, Bike, Package, ShoppingBasket } from "lucide-react";

export const Route = createFileRoute("/_protected/app/")({
  component: AppHome,
});

const services = [
  { to: "/app/food", title: "Food", desc: "Restaurants near you", icon: UtensilsCrossed, color: "from-orange-500/20 to-red-500/10" },
  { to: "/app/grocery", title: "Grocery", desc: "Daily essentials", icon: ShoppingBasket, color: "from-green-500/20 to-emerald-500/10" },
  { to: "/app/ride", title: "Ride", desc: "Book a ride", icon: Bike, color: "from-blue-500/20 to-cyan-500/10" },
  { to: "/app/package", title: "Package", desc: "Send a parcel", icon: Package, color: "from-purple-500/20 to-fuchsia-500/10" },
];

function AppHome() {
  const { user, roles } = useAuth();
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Hello {user?.email?.split("@")[0]} 👋</h1>
        <p className="mt-1 text-muted-foreground">
          What would you like to do today?
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {roles.map((r) => (
            <span key={r} className="rounded-full bg-secondary px-3 py-1 text-xs">
              {r.replace("_", " ")}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {services.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className={`rounded-2xl border bg-gradient-to-br ${s.color} p-6 transition-transform hover:-translate-y-1`}
          >
            <s.icon className="h-10 w-10" />
            <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
