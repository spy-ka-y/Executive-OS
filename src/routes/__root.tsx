import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { DatasetProvider } from "@/lib/dataset-context";
import { IndustryProvider } from "@/lib/industry-context";
import { DbStatus } from "@/components/db-status";
import { BrainStatus } from "@/components/brain-status";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { AuthScreen } from "@/components/auth-screen";
import { Loader2, LogOut } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { Cursor } from "@/components/cursor";
import { RouteProgress } from "@/components/route-progress";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl">404</h1>
        <h2 className="mt-3 text-lg font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          That route doesn't exist in the Copilot.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Back to Dashboard
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ExecutiveOS, AI Executive Operating System" },
      { name: "description", content: "Set business goals and let your AI Executive Team reason, plan, execute and monitor strategic initiatives." },
      { name: "author", content: "ExecutiveOS" },
      { property: "og:title", content: "ExecutiveOS, AI Executive Operating System" },
      { property: "og:description", content: "Your AI Executive Team, from goal to decision to execution in one workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600&family=Inter:wght@300;400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(apiKey){
    (function(p,e,n,d,o){var v,w,x,y,z;o=p[d]=p[d]||{};o._q=o._q||[];
    v=['initialize','identify','updateOptions','pageLoad','track','trackAgent'];for(w=0,x=v.length;w<x;++w)(function(m){
    o[m]=o[m]||function(){o._q[m===v[0]?'unshift':'push']([m].concat([].slice.call(arguments,0)));};})(v[w]);
    y=e.createElement(n);y.async=!0;y.src='https://cdn.pendo.io/agent/static/'+apiKey+'/pendo.js';
    z=e.getElementsByTagName(n)[0];z.parentNode.insertBefore(y,z);})(window,document,'script','pendo');
})('b84b8ba1-8973-4cd5-bf3b-30ea55488ba9');`,
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pendoInitialized = useRef(false);

  useEffect(() => {
    if (pendoInitialized.current) return;
    pendoInitialized.current = true;

    pendo.initialize({ visitor: { id: '' } });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <IndustryProvider>
          <DatasetProvider>
            <AuthGate>
              <RouteProgress />
              <Cursor />
              <SidebarProvider>
                <div className="min-h-screen flex w-full">
                  <AppSidebar />
                  <SidebarInset className="bg-transparent">
                    <header className="h-16 flex items-center gap-3 border-b border-border bg-background/70 backdrop-blur-xl px-6 lg:px-12 sticky top-0 z-30">
                      <SidebarTrigger className="text-foreground/70 hover:text-foreground" />
                      <div className="flex-1" />
                      <div className="flex items-center gap-2">
                        <DbStatus />
                        <BrainStatus />
                      </div>
                      <UserMenu />
                    </header>
                    <main className="flex-1 px-6 lg:px-12 xl:px-16 pt-6 pb-10 lg:pt-8 lg:pb-16 max-w-[1500px] w-full mx-auto">
                      <div key={pathname} className="route-enter">
                        <Outlet />
                      </div>
                    </main>
                  </SidebarInset>
                </div>
              </SidebarProvider>
            </AuthGate>
          </DatasetProvider>
        </IndustryProvider>
        <Toaster richColors theme="light" />
      </AuthProvider>
    </QueryClientProvider>
  );
}

// Renders a loading state, the login screen, or the app depending on auth.
function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return <AuthScreen />;
  return <>{children}</>;
}

// Signed-in user's email + sign-out, in the header.
function UserMenu() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  return (
    <div className="flex items-center gap-2.5 pl-1">
      <span className="hidden md:inline text-xs text-muted-foreground max-w-[16ch] truncate" title={user.email}>
        {user.email}
      </span>
      <button
        onClick={() => signOut()}
        title="Sign out"
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        <LogOut className="h-3 w-3" /> Sign out
      </button>
    </div>
  );
}
