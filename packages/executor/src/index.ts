/**
 * Walks a plan's stages and turns provider answers into evidence.
 *
 * It never makes a call itself. Every call goes through the transport it is
 * handed, which offline reads a recorded response and live posts to Xano, where
 * the key is and where the decision to spend is made. That is what lets the same
 * walk be exercised against fixtures and then run for real without changing.
 */
export * from './resolve.ts'
export * from './run.ts'
