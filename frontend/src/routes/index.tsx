import { createFileRoute, Link } from "@tanstack/react-router";
import { UtensilsCrossed, Bike, Package, ShoppingBasket, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  component: Landing,
});

const services = [
  {
    icon: UtensilsCrossed,
    title: "Food Delivery",
    desc: "Order from your favourite restaurants in minutes.",
    color: "from-orange-500/20 to-red-500/10",
  },
  {
    icon: Bike,
    title: "Rides",
    desc: "Book a ride from one tap to anywhere in the city.",
    color: "from-blue-500/20 to-cyan-500/10",
  },
  {
    icon: Package,
    title: "Package Transfer",
    desc: "Send parcels across town with trusted riders.",
    color: "from-purple-500/20 to-fuchsia-500/10",
  },
  {
    icon: ShoppingBasket,
    title: "Grocery",
    desc: "Daily essentials delivered straight to your door.",
    color: "from-green-500/20 to-emerald-500/10",
  },
];

function Landing() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link to="/" className="text-2xl font-bold tracking-tight">
            Zoomly
          </Link>
          <nav className="flex items-center gap-2">
            {user ? (
              <Button asChild>
                <Link to="/app">Open app</Link>
              </Button>
            ) : (
              <>
                <Button variant="ghost" asChild>
                  <Link to="/login">Login</Link>
                </Button>
                <Button asChild>
                  <Link to="/register">Sign up</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="container mx-auto px-4 py-20 text-center">
          <h1 className="mx-auto max-w-3xl text-5xl font-bold tracking-tight md:text-6xl">
            Everything you need, <span className="text-primary">delivered.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Food, rides, packages and groceries — all in one app. Built for your city.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Button size="lg" asChild>
              <Link to={user ? "/app" : "/register"}>
                Get started <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="container mx-auto px-4 pb-20">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {services.map((s) => (
              <div
                key={s.title}
                className={`rounded-2xl border bg-gradient-to-br ${s.color} p-6 transition-transform hover:-translate-y-1`}
              >
                <s.icon className="h-10 w-10 text-foreground" />
                <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Zoomly. Built with Lovable.
      </footer>
    </div>
  );
}
