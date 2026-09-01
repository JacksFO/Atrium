/**
 * Names people are not allowed to sign up with.
 *
 * Asked for after the obvious hole in an open sign-up: anybody can now make
 * an account without an invite, and a name is the one thing everybody in
 * every server sees whether they want to or not. Somebody choosing a slur for
 * a username puts it in six people's member lists, above every message they
 * send, for as long as they stay.
 *
 * The list is the small half of this. Anybody trying it will try again with
 * a 1 for an i, a zero for an o, a Cyrillic а that looks identical to a
 * Latin one, or letters doubled up - so the work is in reducing a name to
 * what it actually reads as before comparing anything.
 *
 * What this deliberately is not:
 *
 *  - A profanity filter. Swearing in a name is somebody's own business and
 *    six friends can tell each other to pack it in. This is for the things
 *    that are aimed at people.
 *  - Complete. No list is. It is meant to stop the casual case and make the
 *    determined one tedious, and it is easy to add to when something gets
 *    through.
 *  - A moderation system. It refuses a name at the door; it does nothing
 *    about a name already in use, which is a person to deal with rather than
 *    a string to reject.
 */

/**
 * Characters chosen because they look like a letter.
 *
 * Two separate tricks in one table. Digits and punctuation standing in for
 * letters is the old one everybody knows. The dangerous one is the second
 * group: Cyrillic and Greek letters that are not similar to Latin ones but
 * are drawn identically in almost every font, so the name looks completely
 * ordinary and matches nothing.
 */
const LOOKALIKES: Record<string, string> = {
  // Digits and punctuation.
  '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's',
  '6': 'g', '7': 't', '8': 'b', '9': 'g',
  '@': 'a', '$': 's', '!': 'i', '|': 'i', '+': 't', '£': 'e', '€': 'e',
  '(': 'c', '<': 'c', '*': 'a', '¡': 'i', '¿': 'c',

  // Cyrillic, which is the one that actually gets past people.
  'а': 'a', 'в': 'b', 'с': 'c', 'е': 'e', 'н': 'h', 'к': 'k', 'м': 'm',
  'о': 'o', 'р': 'p', 'ѕ': 's', 'т': 't', 'у': 'y', 'х': 'x', 'і': 'i',
  'ј': 'j', 'ԁ': 'd', 'ɡ': 'g', 'ӏ': 'l', 'ԛ': 'q', 'ѡ': 'w', 'ғ': 'f',
  'п': 'n', 'г': 'r', 'з': 'e', 'и': 'u', 'л': 'n', 'ц': 'u', 'я': 'r',

  // Greek.
  'α': 'a', 'β': 'b', 'ε': 'e', 'ι': 'i', 'κ': 'k', 'ν': 'v', 'ο': 'o',
  'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'γ': 'y', 'σ': 's', 'μ': 'u',
  'θ': 'o', 'η': 'n', 'ζ': 'z', 'λ': 'l', 'π': 'n', 'φ': 'o', 'ω': 'w',

  // Fullwidth forms, which paste in from some keyboards.
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e', 'ｆ': 'f', 'ｇ': 'g',
  'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j', 'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n',
  'ｏ': 'o', 'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't', 'ｕ': 'u',
  'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y', 'ｚ': 'z',
}

/**
 * What a name actually reads as.
 *
 * Accents are stripped through NFKD, which also unpacks the mathematical and
 * "fancy" alphabets people paste in - 𝓷𝓲𝓬𝓮 and ⓝⓘⓒⓔ both come out as plain
 * letters. Then the lookalike table, then everything that is not a letter
 * goes entirely: a space, a dot and an underscore are all just a gap, and
 * leaving them in means "a b c" walks past a check on "abc".
 */
export function normaliseName(raw: string): string {
  const unpacked = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  let out = ''
  for (const ch of unpacked) {
    const mapped = LOOKALIKES[ch] ?? ch
    if (mapped >= 'a' && mapped <= 'z') out += mapped
  }
  return out
}

/**
 * The same again with runs of one letter flattened.
 *
 * niiiiigger and niggggger both reduce to the same thing as nigger does, so
 * padding a word out stops being a way through. Compared as a second form
 * rather than instead of the first, because flattening loses real
 * information - it would turn "bell" into "bel" - and only long entries are
 * matched against it, so a short innocent name cannot be caught by it.
 */
function squeeze(s: string): string {
  return s.replace(/(.)\1+/g, '$1')
}

/**
 * Terms refused wherever they appear in a name.
 *
 * Only things that essentially never turn up inside an ordinary word, since
 * these match as substrings. Anything with an innocent host word belongs in
 * the list below instead, or it will refuse somebody's real name.
 */
const ANYWHERE: string[] = [
  // Racial and ethnic slurs.
  'nigger', 'nigga', 'niglet', 'prairienigger', 'sandnigger', 'shitskin',
  'jigaboo', 'porchmonkey', 'spearchucker', 'tarbaby', 'kaffir',
  'chink', 'chinaman', 'slanteye', 'gook',
  'currymuncher', 'towelhead', 'raghead', 'cameljockey',
  'wetback', 'beaner', 'kike', 'sheeny',
  'gyppo', 'zigeuner', 'redskin', 'squaw', 'wigger', 'honky',

  // Homophobic and transphobic slurs.
  'faggot', 'fagot', 'tranny', 'shemale', 'ladyboy', 'poofter',
  'battyboy', 'queerbait',

  // Ableist slurs.
  'retard', 'mongoloid', 'spastic', 'cripple',

  // Nazi and organised-hate references.
  'hitler', 'nazi', 'gestapo', 'auschwitz', 'holocaust', 'heilhitler',
  'siegheil', 'whitepower', 'whitepride', 'kkk', 'kuklux',
  'bloodandsoil', 'fourteenwords', 'groyper', 'gaschamber', 'gasthejews',
  /*
   * Lynch is not here on its own, and must not be: it is one of the
   * commonest surnames in Ireland, and refusing somebody their own name -
   * with a message that will not say why - is the worst thing this can do.
   * Only the phrases that can mean nothing else.
   */
  'lynchmob', 'lynchthe', 'gonnalynch',

  // Sexual violence and children, which is not an edgy joke.
  'rapist', 'molest', 'pedophile', 'paedophile', 'childporn', 'jailbait',
  'lolicon', 'incest',

  // Aimed at somebody.
  'killyourself', 'neckyourself',
]

/**
 * Terms refused only when they are the whole name.
 *
 * Everything short, and everything that sits inside an ordinary word. This
 * is where most of the care went, because refusing a real person is a worse
 * failure than letting a rude name through: one of them is somebody who
 * cannot sign up and is not told why.
 *
 * 'paki' is in 'Pakistani'. 'nip' is in 'parsnip'. 'pedo' is in 'pedometer'.
 * 'coon' is in 'raccoon'. 'spic' is in 'spicy'. 'rape' is in 'grape'. 'dyke'
 * is a surname and a wall. 'adolf' is inside 'Adolfo'. 'lynch' is one of the
 * commonest surnames in Ireland. Every one of those was in the list above
 * until this comment was written, and every one of them would have turned
 * somebody away.
 */
const WHOLE: string[] = [
  // Slurs short enough, or common enough inside other words, to need a whole
  // name to match. Still refused - just not as a fragment of something else.
  'paki', 'nip', 'jap', 'yid', 'wop', 'dago', 'spic', 'coon', 'negro',
  'fag', 'fags', 'dyke', 'tard', 'abbo', 'boong', 'pikey', 'injun',
  'heeb', 'zhid', 'greaser', 'kafir', 'pedo', 'paedo', 'rape',
  'adolf', 'kys', 'cp',

  // Crude rather than aimed. Refused as a name because it is on everybody
  // else's screen all evening, not because the word is forbidden.
  'cunt', 'twat', 'wanker', 'bellend', 'nonce', 'slut', 'whore',
  'anal', 'cum', 'jizz', 'dildo', 'buttplug', 'blowjob', 'handjob',
  'cock', 'dick', 'penis', 'vagina', 'clit', 'bollocks',
  'bitch', 'bastard', 'arsehole', 'asshole', 'shithead', 'motherfucker',
  'fuck', 'fucker', 'shit', 'piss', 'wank',

  'suicide', 'selfharm', 'terrorist', 'isis', 'alqaeda', 'jihadi',
]

/**
 * Real words that happen to contain something on the ANYWHERE list.
 *
 * Checked before anything else, so a name that is genuinely one of these is
 * never refused. Short on purpose: it is a list of known collisions, not a
 * general escape hatch. Everything that needed a long allowlist was moved to
 * WHOLE instead, which is the better fix.
 */
const ALLOWED: string[] = [
  // 'nigger' does not appear in these, but 'nigga' does not either - these
  // are here because people called Nigel and places called Niger exist and
  // the cost of being wrong about them is high.
  'niger', 'nigeria', 'nigerian', 'nigel', 'snigger', 'niggle', 'niggling',
  // ... 'retard'.
  'retardant', 'flameretardant',
  // ... 'cripple'.
  'crippled',
  // ... 'nazi', which is inside nothing innocent in English but is a real
  // (if uncommon) surname spelled Nazi in a few places.
  'nazir', 'nazim',
  // ... 'holocaust', for anybody naming themselves after the study of it.
  'holocaustremembrance',
  /*
   * ... 'rapist', which sits inside 'therapist'. Found by the tests rather
   * than by thinking about it, which is rather the point of having them:
   * this one would have refused a real word nobody would have guessed at.
   */
  'therapist', 'therapists', 'physiotherapist', 'psychotherapist',
]

/**
 * Whether a name can be used.
 *
 * Returns null when it is fine, and a reason when it is not. The reason is
 * for logs, not for the person: telling somebody exactly which word tripped
 * the check is telling them exactly what to edit, and the message they see
 * says only that the name is not allowed.
 */
export function nameProblem(raw: string): string | null {
  if (typeof raw !== 'string') return 'not a string'

  const plain = normaliseName(raw)
  if (plain.length === 0) {
    // Nothing but digits, punctuation or symbols. Not a name, and it makes
    // somebody impossible to refer to in a sentence.
    return 'no letters in it'
  }

  const squeezed = squeeze(plain)

  /*
   * Known collisions first, so a real word is never refused by the lists.
   *
   * Exact only. Comparing the flattened forms here was a hole rather than a
   * kindness: nigger flattens to niger, which is a country on this list, so
   * the allowlist quietly let through the very word the list above exists
   * for. An allowlist entry means "this exact word is fine", never "anything
   * that collapses to this is fine".
   */
  for (const ok of ALLOWED) {
    if (plain === ok) return null
  }

  for (const term of ANYWHERE) {
    const t = normaliseName(term)
    if (!t) continue
    if (plain.includes(t)) return `contains ${term}`
    // Only long terms are matched against the flattened form: 'cp' squeezed
    // would catch far too much.
    if (t.length >= 4 && squeezed.includes(squeeze(t))) return `contains ${term} padded out`
  }

  for (const term of WHOLE) {
    const t = normaliseName(term)
    if (!t) continue
    if (plain === t || squeezed === squeeze(t)) return `is ${term}`
  }

  return null
}

/** The one thing anybody trying a name is told, whichever rule caught it. */
export const NAME_REFUSED = 'That name is not allowed. Please choose another.'
