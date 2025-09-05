// --- CREATE THIS NEW FILE ---
// Path: src/types/libsodium-wrappers.d.ts

/**
 * This declaration file tells TypeScript that the 'libsodium-wrappers' module exists,
 * even though it doesn't have its own type definitions. This resolves the build error
 * TS7016 by explicitly declaring the module, allowing it to be imported and used
 * in the project without type-checking errors.
 */
declare module 'libsodium-wrappers';
