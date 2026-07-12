import { Outlet, Link, createRootRoute } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth-context";
import { LocationProvider } from "@/lib/location-context";
import { Toaster } from "@/components/ui/sonner";
import { SystemThemeSync } from "@/components/system-theme-sync";
import { AndroidAppDownloadPrompt } from "@/components/android-app-download-prompt";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootComponent() {
  return (
    <AuthProvider>
      <LocationProvider>
        <SystemThemeSync />
        <AndroidAppDownloadPrompt />
        <Outlet />
        <Toaster richColors position="top-right" />
      </LocationProvider>
    </AuthProvider>
  );
}
