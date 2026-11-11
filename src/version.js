import pkg from '../package.json' with { type: 'json' };

/** The published package version, read from package.json so it can never drift. */
export const VERSION = pkg.version;
