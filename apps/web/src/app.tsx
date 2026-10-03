import { LayerProvider } from "@astryxdesign/core/Layer";
import { Heading } from "@astryxdesign/core/Text";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

export function App() {
  return (
    <Theme theme={neutralTheme}>
      <LayerProvider>
        <Heading level={1}>Event Desk</Heading>
      </LayerProvider>
    </Theme>
  );
}
