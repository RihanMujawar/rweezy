import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { ShellActions } from "@/components/shell-actions";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_protected")({
  component: ProtectedLayout,
});

function ProtectedLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20 p-6">
        <div className="w-full max-w-md space-y-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex flex-1 flex-col">
          <header className="hidden h-12 items-center border-b px-2 md:flex">
            <SidebarTrigger />
            <ShellActions />
          </header>
          <main className="flex-1 bg-muted/20 pb-28 md:pb-0">
            <Outlet />
          </main>
          <MobileBottomNav />
        </div>
      </div>
    </SidebarProvider>
  );
}
