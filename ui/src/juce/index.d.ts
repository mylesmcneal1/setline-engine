// Types for JUCE 8's frontend helper (vendored from juce_gui_extra/native/javascript, JUCE 8.0.14).
export function getNativeFunction(name: string): (...args: unknown[]) => Promise<unknown>;
export function getBackendResourceAddress(path: string): string;
