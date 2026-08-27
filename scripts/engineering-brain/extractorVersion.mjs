// Bump this whenever any extraction logic changes (symbol/SQL/section extraction, classification,
// hashing) -- incremental reuse (incrementalReuse.mjs) is keyed on a file's git blob SHA, which only
// tells you the *file* didn't change; it says nothing about whether the *code that reads* the file
// changed. Without this version check, fixing an extractor bug would silently never take effect for
// any file whose blob SHA is unchanged, since the (now-wrong) previous records would keep getting
// reused forever. Bumping this forces one full rebuild after any extractor change; the next run
// after that is incremental again.
export const EXTRACTOR_VERSION = 2;
