import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The product searches twelve kinds of place and must sound like it.
 *
 * It grew out of a rental tool, and the rental words outlived the narrow
 * product: somebody asking for a restaurant was met by a box labelled "Rent up
 * to", told a cafe was "no longer listed", and offered an example about
 * bedrooms. This reads the strings a person actually sees and fails when a
 * housing word appears without the subject being housing.
 */
const SOURCE = join(import.meta.dirname)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.tsx') || (path.endsWith('.ts') && !path.endsWith('.test.ts'))
      ? [path]
      : []
  })
}

/**
 * Only what reaches a screen. Comments explain the code to whoever maintains it
 * and may say "home" all they like; a quoted string is read by a stranger.
 */
function visibleStrings(source: string): string[] {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutComments = withoutBlockComments.replace(/^\s*\/\/.*$/gm, '')
  // No newlines: a sentence somebody reads sits on one line, and allowing them
  // lets a match run from one JSX attribute to the next and catch the markup
  // in between.
  return [
    ...withoutComments.matchAll(/'((?:[^'\\\n]|\\.){12,}?)'|"((?:[^"\\\n]|\\.){12,}?)"/g),
  ].map((hit) => hit[1] ?? hit[2] ?? '')
}

/** Words that are only true of somewhere you live. */
const HOUSING = /\b(rent|rents|rental|bedrooms?|landlord|tenanc)/i

/**
 * Strings allowed to say them, because they only ever describe a home: the
 * worked examples per subject, and the labels shown behind a dwelling check.
 */
const ALLOWED = /Rent up to|one bedroom|Houses for sale|in-unit laundry|bedroom,/

describe('the words a stranger reads', () => {
  const offenders = sourceFiles(SOURCE).flatMap((file) =>
    visibleStrings(readFileSync(file, 'utf8'))
      .filter((text) => HOUSING.test(text) && !ALLOWED.test(text))
      .map((text) => `${file.replace(SOURCE, '')}: ${text.slice(0, 70)}`),
  )

  it('never assume somewhere to live', () => {
    expect(offenders).toEqual([])
  })
})
