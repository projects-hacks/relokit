/**
 * The pure half: repairing a model's answer against the words it came from.
 * Safe anywhere, including a browser.
 *
 * Reading a prompt off disk and calling a provider are server things and live
 * in ./node, so importing this cannot drag a filesystem into a bundle.
 */
export * from './units.ts'
export * from './normalize.ts'
