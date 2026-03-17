interface ImportMeta {
  glob<Module = Record<string, unknown>>(
    pattern: string,
    options?: { eager?: boolean },
  ): Record<string, Module>
}
