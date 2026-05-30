import { Construction } from "lucide-react";

export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div className="container mx-auto px-4 py-20 text-center">
      <Construction className="mx-auto h-12 w-12 text-muted-foreground" />
      <h1 className="mt-4 text-2xl font-bold">{title}</h1>
      {description && <p className="mt-2 text-muted-foreground">{description}</p>}
    </div>
  );
}

export function RoleGate({
  allowed,
  hasAny,
  children,
}: {
  allowed: string[];
  hasAny: boolean;
  children: React.ReactNode;
}) {
  if (!hasAny) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold">Access denied</h1>
        <p className="mt-2 text-muted-foreground">
          You need one of these roles: {allowed.join(", ")}. Ask an admin to assign it.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
