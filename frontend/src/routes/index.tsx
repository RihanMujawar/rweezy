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
    <div className="min-h-screen bg-transparent">
      <header className="border-b border-white/10 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <Link
            to="/"
            className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent hover:opacity-90 transition-opacity"
          >
            Rweezy
          </Link>
          <nav className="flex items-center gap-2">
            {user ? (
              <Button asChild className="btn-interactive shadow-lg shadow-primary/20">
                <Link to="/app">Open app</Link>
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  asChild
                  className="btn-interactive hover:bg-white/10 dark:hover:bg-white/5"
                >
                  <Link to="/login">Login</Link>
                </Button>
                <Button asChild className="btn-interactive shadow-lg shadow-primary/20">
                  <Link to="/register">Sign up</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="animate-fade-in-up">
        <section className="container mx-auto px-4 py-24 text-center">
          <h1 className="mx-auto max-w-3xl text-5xl font-extrabold tracking-tight md:text-7xl leading-none">
            Everything you need,{" "}
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent">
              delivered.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground md:text-xl">
            Food, rides, packages and groceries — all in one app. Built for your city.
          </p>
          <div className="mt-10 flex justify-center gap-3">
            <Button
              size="lg"
              asChild
              className="btn-interactive h-12 px-8 text-base shadow-xl shadow-primary/25"
            >
              <Link to={user ? "/app" : "/register"}>
                Get started <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="container mx-auto px-4 pb-24">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {services.map((s) => (
              <div
                key={s.title}
                className="liquid-glass-card p-6 flex flex-col items-start relative group"
              >
                <div
                  className={`absolute top-0 right-0 w-28 h-28 rounded-full bg-gradient-to-br ${s.color} blur-[30px] opacity-60 group-hover:scale-125 transition-transform duration-500`}
                />
                <div className="relative z-10 flex flex-col h-full justify-between">
                  <div>
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 dark:bg-black/20 border border-white/20 backdrop-blur-sm shadow-inner group-hover:scale-110 transition-transform duration-300">
                      <s.icon className="h-6 w-6 text-foreground" />
                    </span>
                    <h3 className="mt-4 text-xl font-bold tracking-tight">{s.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-8 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Rweezy
      </footer>
    </div>
  );
}
