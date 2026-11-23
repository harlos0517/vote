import { useState, type ReactNode } from "react";
import { Collapse, Stack, Text, UnstyledButton } from "@mantine/core";

/** A folded section: a small clickable heading that shows or hides its content (建議 9). */
export function Fold({ label, children, initiallyOpen = false }: { label: ReactNode; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <Stack gap={4}>
      <UnstyledButton onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Text size="xs" c="dimmed">
          {open ? "▾" : "▸"} {label}
        </Text>
      </UnstyledButton>
      <Collapse expanded={open}>{children}</Collapse>
    </Stack>
  );
}
