import { useMediaQuery } from "@mantine/hooks";

/** Phone layout (below Mantine's `sm` breakpoint, 48em): full-width controls, horizontal legend. */
export const useNarrow = () => useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
