import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ConfirmDialog from "./components/ConfirmDialog";
import { queryClient } from "./config/queryClient";
import RootRoutes from "./routes";
import { useThemeStore } from "./store/themeStore";

const App = () => {
  // The on-screen scheme ("auto" already resolved) — keeps toasts in sync.
  const resolved = useThemeStore((s) => s.resolved);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RootRoutes />
        {/* Toast sink (sonner). */}
        <Toaster theme={resolved}position="top-right" richColors closeButton />
        {/* Imperative confirm() host. */}
        <ConfirmDialog />
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
