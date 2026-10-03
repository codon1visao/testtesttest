import { AppProviders } from "./app-providers";
import { AppRoutes } from "./routes";

export function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  );
}
