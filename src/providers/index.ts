import { dataforseo } from "./dataforseo.ts";
import type { Provider } from "./provider.ts";

export const PROVIDERS: Provider[] = [dataforseo];
export const DEFAULT_PROVIDER = dataforseo.id;

export function findProvider(id: string): Provider | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

export type { Provider } from "./provider.ts";
