if (!globalThis.__wwJsonExporterBootstrapped) {
  globalThis.__wwJsonExporterBootstrapped = true;
  if (typeof bootstrapContentScript === "function") {
    bootstrapContentScript();
  }
}
