import { requireOptionalNativeModule } from "expo";
import { isPad } from "./layout";

/**
 * Hardware keyboard shortcuts on iPad, through the local
 * `modules/hark-key-commands` native module. Builds without the module,
 * iPhone and tests do nothing.
 */
export type KeyModifier = "command" | "shift" | "option" | "control";

export interface KeyCommand {
  id: string;
  /** A character ("r", "1", "[") or "left"/"right"/"up"/"down"/"escape". */
  input: string;
  modifiers: KeyModifier[];
  /** Shown in the overlay that appears while ⌘ is held. */
  title: string;
}

interface HarkKeyCommandsModule {
  setCommands(commands: KeyCommand[]): void;
  addListener(
    event: "onKeyCommand",
    listener: (event: { id: string }) => void,
  ): {
    remove(): void;
  };
}

const native = isPad ? requireOptionalNativeModule<HarkKeyCommandsModule>("HarkKeyCommands") : null;
const handlers = new Map<string, Set<() => void>>();

native?.addListener("onKeyCommand", ({ id }) => {
  for (const handler of handlers.get(id) ?? []) handler();
});

/** Replaces the whole set of shortcuts. */
export function setKeyCommands(commands: KeyCommand[]): void {
  native?.setCommands(commands);
}

/** Runs `handler` whenever the shortcut with this id fires; returns the unsubscribe. */
export function onKeyCommand(id: string, handler: () => void): () => void {
  const set = handlers.get(id) ?? new Set();
  set.add(handler);
  handlers.set(id, set);
  return () => {
    set.delete(handler);
  };
}
