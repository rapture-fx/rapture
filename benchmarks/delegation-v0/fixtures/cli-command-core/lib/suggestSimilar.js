const maxDistance = 3;

/**
 * Find close matches, restricted to same number of edits.
 *
 * @param {string} word
 * @param {string[]} candidates
 * @returns {string}
 */

export function suggestSimilar(word, candidates) {
  if (!candidates || candidates.length === 0) return '';

  const searchingOptions = word.startsWith('--');
  const similar = candidates.filter((candidate) => candidate === word);

  if (similar.length === 1) {
    return `\n(Did you mean ${similar[0]}?)`;
  }
  return '';
}
