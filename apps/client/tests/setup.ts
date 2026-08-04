import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library only auto-registers its between-test unmount when vitest
// injects globals, which this repo's explicit-imports convention disables --
// without this hook every render() accumulates in the shared jsdom document
// and label queries start matching duplicate mounted trees.
afterEach(cleanup);
