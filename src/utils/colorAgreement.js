// `closet.colors` in ru.json stores each color as its masculine nominative
// adjective form ("Серый") — the dictionary form. But garment nouns
// (`item.subcategory`, AI-generated free text like "Футболка"/"Платье"/
// "Джинсы") vary in grammatical gender/number, so the color has to agree
// with whatever noun it's displayed next to ("серая футболка", not "серый
// футболка"). Regular Russian color adjectives decline by a fully
// mechanical suffix swap, so this is a lookup-free transform rather than a
// second translation table to keep in sync with `closet.colors`.

// Common indeclinable loanwords that are grammatically neuter singular
// despite ending in a letter the general heuristic below would read as
// plural (худи, поло) — small enough to special-case directly.
const NEUTER_LOANWORDS = new Set(['худи', 'поло', 'кимоно']);

function guessNounGender(noun) {
  const word = (noun || '').trim().split(/\s+/).pop() || '';
  const lower = word.toLowerCase();
  if (NEUTER_LOANWORDS.has(lower)) return 'neuter';
  const last = lower.slice(-1);
  if (last === 'ы' || last === 'и') return 'plural';
  if (last === 'а' || last === 'я') return 'feminine';
  if (last === 'о' || last === 'е' || last === 'ё') return 'neuter';
  return 'masculine';
}

function declineColorAdjective(masculineForm, gender) {
  if (gender === 'masculine') return masculineForm;
  const isSoft = masculineForm.endsWith('ий');
  const endings = {
    feminine: isSoft ? 'яя' : 'ая',
    neuter: isSoft ? 'ее' : 'ое',
    plural: isSoft ? 'ие' : 'ые',
  };
  return masculineForm.replace(/(ый|ой|ий)$/, endings[gender]);
}

// Agrees a masculine-form color adjective ("Серый") with the noun it's
// about to be shown next to ("Футболка") — e.g. agreeColorWithNoun("Серый",
// "Футболка") === "Серая".
export function agreeColorWithNoun(colorMasculine, noun) {
  if (!colorMasculine || !noun) return colorMasculine;
  return declineColorAdjective(colorMasculine, guessNounGender(noun));
}
