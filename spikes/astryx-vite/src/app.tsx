import { Button } from "@astryxdesign/core/Button";
import { LayerProvider } from "@astryxdesign/core/Layer";
import { VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Theme } from "@astryxdesign/core/theme";
import { useToast } from "@astryxdesign/core/Toast";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { deriveAttendanceCounts, SUPPLIED_EVENT, SUPPLIED_MEMBERS } from "@event-desk/contracts";

function SaveProbe() {
  const showToast = useToast();
  return <Button label="Save attendance" onClick={() => showToast({ body: "Attendance saved" })} />;
}

export function App() {
  const counts = deriveAttendanceCounts(SUPPLIED_MEMBERS);
  return (
    <Theme theme={neutralTheme}>
      <LayerProvider>
        <VStack gap={4}>
          <Heading level={1}>{SUPPLIED_EVENT.name}</Heading>
          <Text type="body">
            {counts.registered} registered: {counts.attended} attended, {counts.absent} absent,{" "}
            {counts.notRecorded} not recorded
          </Text>
          <SaveProbe />
        </VStack>
      </LayerProvider>
    </Theme>
  );
}
