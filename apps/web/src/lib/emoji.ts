/**
 * The emoji this app knows by name.
 *
 * This was a short list on purpose, and the argument was a good one: a picker
 * with two thousand faces in it is a thing to browse, and what somebody wants
 * is a thing to reach for. What changed is that the reaching is now done by
 * something else. There is a row of the ones you last used above the picker,
 * and the search below it puts what you type first - so the long tail costs
 * nothing to anybody who is not looking for it, and the fifty-odd we had
 * meant that anybody looking for a horse or a cup of tea simply did not find
 * one and had no way to know whether it was missing or misnamed.
 *
 * Curated rather than the whole of Unicode. Around three hundred, chosen for
 * being the ones people actually type, each in exactly one group. The names
 * follow the shortcodes people already know from elsewhere, so `:joy:` is the
 * crying-laughing face here as well - somebody who learned them in another
 * app should not have to learn them again.
 *
 * Every name that was here before is still here, because messages already
 * sent contain them and a renamed shortcode would quietly turn into text.
 *
 * Names are the shortcode without its colons, so `:fire:` finds 🔥 and the
 * same table answers both the picker and the renderer. Two tables would be
 * two answers to one question, and the one on screen would be the wrong one.
 */

export type EmojiGroup = readonly [string, ReadonlyArray<readonly [string, string]>]

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  ['Smileys', [
    ['grinning', '😀'], ['smiley', '😃'], ['smile', '😄'], ['grin', '😁'],
    ['laughing', '😆'], ['sweat_smile', '😅'], ['rofl', '🤣'], ['joy', '😂'],
    ['slight_smile', '🙂'], ['upside_down', '🙃'], ['wink', '😉'], ['blush', '😊'],
    ['innocent', '😇'], ['heart_eyes', '😍'], ['star_struck', '🤩'],
    ['kissing_heart', '😘'], ['yum', '😋'], ['tongue', '😛'], ['zany', '🤪'],
    ['money_mouth', '🤑'], ['hugging', '🤗'], ['hand_over_mouth', '🤭'],
    ['shush', '🤫'], ['thinking', '🤔'], ['zipper_mouth', '🤐'],
    ['raised_eyebrow', '🤨'], ['neutral', '😐'], ['expressionless', '😑'],
    ['no_mouth', '😶'], ['smirk', '😏'], ['unamused', '😒'], ['rolling_eyes', '🙄'],
    ['grimacing', '😬'], ['lying', '🤥'], ['relieved', '😌'], ['pensive', '😔'],
    ['sleepy', '😪'], ['drooling', '🤤'], ['sleeping', '😴'], ['mask', '😷'],
    ['thermometer', '🤒'], ['nauseated', '🤢'], ['sneezing', '🤧'], ['hot', '🥵'],
    ['cold', '🥶'], ['woozy', '🥴'], ['dizzy_face', '😵'], ['exploding_head', '🤯'],
    ['cowboy', '🤠'], ['partying', '🥳'], ['disguised', '🥸'], ['sunglasses', '😎'],
    ['nerd', '🤓'], ['monocle', '🧐'], ['confused', '😕'], ['worried', '😟'],
    ['frowning', '🙁'], ['open_mouth', '😮'], ['hushed', '😯'], ['astonished', '😲'],
    ['flushed', '😳'], ['pleading', '🥺'], ['anguished', '😧'], ['fearful', '😨'],
    ['anxious', '😰'], ['cry', '😢'], ['sob', '😭'], ['scream', '😱'],
    ['confounded', '😖'], ['persevere', '😣'], ['disappointed', '😞'],
    ['sweat', '😓'], ['weary', '😩'], ['tired', '😫'], ['yawning', '🥱'],
    ['triumph', '😤'], ['rage', '😡'], ['angry', '😠'], ['cursing', '🤬'],
    ['smiling_imp', '😈'], ['imp', '👿'], ['skull', '💀'], ['poop', '💩'],
    ['clown', '🤡'], ['ghost', '👻'], ['alien', '👽'], ['robot', '🤖'],
    ['melting', '🫠'], ['salute', '🫡'], ['shaking', '🫨'],
  ]],
  ['People', [
    ['wave', '👋'], ['raised_hand', '✋'], ['vulcan', '🖖'], ['ok_hand', '👌'],
    ['pinched_fingers', '🤌'], ['pinching', '🤏'], ['victory', '✌️'],
    ['crossed_fingers', '🤞'], ['love_you', '🤟'], ['metal', '🤘'],
    ['call_me', '🤙'], ['point_left', '👈'], ['point_right', '👉'],
    ['point_up', '👆'], ['point_down', '👇'], ['thumbsup', '👍'],
    ['thumbsdown', '👎'], ['fist', '✊'], ['punch', '👊'], ['clap', '👏'],
    ['raised_hands', '🙌'], ['open_hands', '👐'], ['palms_up', '🤲'],
    ['handshake', '🤝'], ['pray', '🙏'], ['muscle', '💪'], ['writing_hand', '✍️'],
    ['nail_care', '💅'], ['selfie', '🤳'], ['eyes', '👀'], ['eye', '👁️'],
    ['brain', '🧠'], ['ear', '👂'], ['nose', '👃'], ['lips', '👄'],
    ['baby', '👶'], ['person', '🧑'], ['man', '👨'], ['woman', '👩'],
    ['older_person', '🧓'], ['detective', '🕵️'], ['guard', '💂'],
    ['ninja', '🥷'], ['mage', '🧙'], ['fairy', '🧚'], ['vampire', '🧛'],
    ['zombie', '🧟'], ['santa', '🎅'], ['superhero', '🦸'], ['supervillain', '🦹'],
    ['shrug', '🤷'], ['facepalm', '🤦'], ['dancer', '💃'], ['running', '🏃'],
    ['walking', '🚶'], ['sleeping_person', '🛌'],
  ]],
  ['Nature', [
    ['dog', '🐶'], ['cat', '🐱'], ['mouse', '🐭'], ['hamster', '🐹'],
    ['rabbit', '🐰'], ['fox', '🦊'], ['bear', '🐻'], ['panda', '🐼'],
    ['koala', '🐨'], ['tiger', '🐯'], ['lion', '🦁'], ['cow', '🐮'],
    ['pig', '🐷'], ['frog', '🐸'], ['monkey', '🐵'], ['see_no_evil', '🙈'],
    ['hear_no_evil', '🙉'], ['speak_no_evil', '🙊'], ['chicken', '🐔'],
    ['penguin', '🐧'], ['bird', '🐦'], ['duck', '🦆'], ['eagle', '🦅'],
    ['owl', '🦉'], ['bat', '🦇'], ['wolf', '🐺'], ['boar', '🐗'],
    ['horse', '🐴'], ['unicorn', '🦄'], ['bee', '🐝'], ['bug', '🐛'],
    ['butterfly', '🦋'], ['snail', '🐌'], ['spider', '🕷️'], ['snake', '🐍'],
    ['turtle', '🐢'], ['lizard', '🦎'], ['fish', '🐠'], ['dolphin', '🐬'],
    ['whale', '🐳'], ['shark', '🦈'], ['octopus', '🐙'], ['crab', '🦀'],
    ['elephant', '🐘'], ['giraffe', '🦒'], ['zebra', '🦓'], ['hedgehog', '🦔'],
    ['sheep', '🐑'], ['goat', '🐐'], ['deer', '🦌'], ['paw_prints', '🐾'],
    ['dragon', '🐉'], ['sun', '☀️'], ['moon', '🌙'], ['star', '⭐'],
    ['sparkles', '✨'], ['zap', '⚡'], ['fire', '🔥'], ['rainbow', '🌈'],
    ['cloud', '☁️'], ['rain', '🌧️'], ['snow', '❄️'], ['snowman', '⛄'],
    ['droplet', '💧'], ['ocean', '🌊'], ['tornado', '🌪️'], ['leaf', '🍃'],
    ['four_leaf_clover', '🍀'], ['maple_leaf', '🍁'], ['mushroom', '🍄'],
    ['cactus', '🌵'], ['palm_tree', '🌴'], ['tree', '🌲'], ['rose', '🌹'],
    ['tulip', '🌷'], ['sunflower', '🌻'], ['blossom', '🌸'], ['earth', '🌍'],
    ['volcano', '🌋'],
  ]],
  ['Food', [
    ['apple', '🍎'], ['pear', '🍐'], ['orange', '🍊'], ['lemon', '🍋'],
    ['banana', '🍌'], ['watermelon', '🍉'], ['grapes', '🍇'], ['strawberry', '🍓'],
    ['cherries', '🍒'], ['peach', '🍑'], ['pineapple', '🍍'], ['coconut', '🥥'],
    ['avocado', '🥑'], ['tomato', '🍅'], ['corn', '🌽'], ['carrot', '🥕'],
    ['bread', '🍞'], ['croissant', '🥐'], ['cheese', '🧀'], ['egg', '🥚'],
    ['bacon', '🥓'], ['pancakes', '🥞'], ['burger', '🍔'], ['fries', '🍟'],
    ['pizza', '🍕'], ['hotdog', '🌭'], ['sandwich', '🥪'], ['taco', '🌮'],
    ['burrito', '🌯'], ['popcorn', '🍿'], ['salad', '🥗'], ['spaghetti', '🍝'],
    ['ramen', '🍜'], ['sushi', '🍣'], ['rice', '🍚'], ['curry', '🍛'],
    ['cake', '🍰'], ['birthday', '🎂'], ['cupcake', '🧁'], ['cookie', '🍪'],
    ['chocolate', '🍫'], ['candy', '🍬'], ['doughnut', '🍩'], ['ice_cream', '🍦'],
    ['honey', '🍯'], ['coffee', '☕'], ['tea', '🍵'], ['beer', '🍺'],
    ['beers', '🍻'], ['wine', '🍷'], ['cocktail', '🍸'], ['champagne', '🍾'],
    ['whisky', '🥃'], ['milk', '🥛'], ['bubble_tea', '🧋'],
  ]],
  ['Activities', [
    ['soccer', '⚽'], ['basketball', '🏀'], ['football', '🏈'], ['baseball', '⚾'],
    ['tennis', '🎾'], ['volleyball', '🏐'], ['rugby', '🏉'], ['pool_ball', '🎱'],
    ['ping_pong', '🏓'], ['badminton', '🏸'], ['goal', '🥅'], ['hockey', '🏒'],
    ['cricket', '🏏'], ['golf', '⛳'], ['bow_and_arrow', '🏹'], ['fishing', '🎣'],
    ['boxing', '🥊'], ['martial_arts', '🥋'], ['ski', '🎿'], ['skateboard', '🛹'],
    ['ice_skate', '⛸️'], ['trophy', '🏆'], ['medal', '🏅'], ['first_place', '🥇'],
    ['second_place', '🥈'], ['third_place', '🥉'], ['game', '🎮'],
    ['joystick', '🕹️'], ['dice', '🎲'], ['dart', '🎯'], ['slot_machine', '🎰'],
    ['bowling', '🎳'], ['jigsaw', '🧩'], ['teddy', '🧸'], ['art', '🎨'],
    ['clapper', '🎬'], ['microphone', '🎤'], ['headphones', '🎧'],
    ['musical_note', '🎵'], ['notes', '🎶'], ['guitar', '🎸'], ['piano', '🎹'],
    ['trumpet', '🎺'], ['drum', '🥁'], ['saxophone', '🎷'], ['ticket', '🎟️'],
    ['circus', '🎪'], ['performing_arts', '🎭'],
  ]],
  ['Travel', [
    ['car', '🚗'], ['taxi', '🚕'], ['bus', '🚌'], ['ambulance', '🚑'],
    ['fire_engine', '🚒'], ['police_car', '🚓'], ['truck', '🚚'],
    ['tractor', '🚜'], ['bike', '🚲'], ['scooter', '🛴'], ['motorcycle', '🏍️'],
    ['airplane', '✈️'], ['rocket', '🚀'], ['helicopter', '🚁'], ['ship', '🚢'],
    ['sailboat', '⛵'], ['train', '🚆'], ['metro', '🚇'], ['anchor', '⚓'],
    ['fuel', '⛽'], ['traffic_light', '🚦'], ['house', '🏠'], ['office', '🏢'],
    ['hospital', '🏥'], ['bank', '🏦'], ['hotel', '🏨'], ['school', '🏫'],
    ['castle', '🏰'], ['tent', '⛺'], ['world_map', '🗺️'], ['compass', '🧭'],
    ['mountain', '⛰️'], ['beach', '🏖️'], ['city', '🌆'], ['night', '🌃'],
    ['bridge', '🌉'], ['statue_of_liberty', '🗽'], ['ferris_wheel', '🎡'],
  ]],
  ['Objects', [
    ['watch', '⌚'], ['phone', '📱'], ['laptop', '💻'], ['keyboard', '⌨️'],
    ['desktop', '🖥️'], ['printer', '🖨️'], ['camera', '📷'], ['video_camera', '📹'],
    ['tv', '📺'], ['radio', '📻'], ['battery', '🔋'], ['plug', '🔌'],
    ['bulb', '💡'], ['flashlight', '🔦'], ['candle', '🕯️'], ['book', '📖'],
    ['books', '📚'], ['notebook', '📓'], ['pencil', '✏️'], ['pen', '🖊️'],
    ['paperclip', '📎'], ['scissors', '✂️'], ['key', '🔑'], ['lock', '🔒'],
    ['unlock', '🔓'], ['hammer', '🔨'], ['wrench', '🔧'], ['screwdriver', '🪛'],
    ['nut_and_bolt', '🔩'], ['gear', '⚙️'], ['chains', '⛓️'], ['magnet', '🧲'],
    ['bomb', '💣'], ['magnifying', '🔍'], ['hourglass', '⌛'],
    ['alarm_clock', '⏰'], ['calendar', '📅'], ['chart_up', '📈'],
    ['chart_down', '📉'], ['clipboard', '📋'], ['folder', '📁'], ['page', '📄'],
    ['envelope', '✉️'], ['inbox', '📥'], ['outbox', '📤'], ['package', '📦'],
    ['label', '🏷️'], ['money', '💰'], ['dollar', '💵'], ['credit_card', '💳'],
    ['gem', '💎'], ['gift', '🎁'], ['balloon', '🎈'], ['tada', '🎉'],
    ['confetti', '🎊'], ['ribbon', '🎀'], ['crown', '👑'], ['ring', '💍'],
    ['umbrella', '☂️'], ['briefcase', '💼'], ['toolbox', '🧰'], ['bell', '🔔'],
    ['no_bell', '🔕'], ['megaphone', '📢'], ['loudspeaker', '📣'],
    ['speech_balloon', '💬'], ['thought_balloon', '💭'], ['zzz', '💤'],
    ['test_tube', '🧪'], ['telescope', '🔭'], ['microscope', '🔬'],
    ['syringe', '💉'], ['pill', '💊'], ['broom', '🧹'], ['soap', '🧼'],
    ['thread', '🧵'], ['crystal_ball', '🔮'],
  ]],
  ['Symbols', [
    ['heart', '❤️'], ['orange_heart', '🧡'], ['yellow_heart', '💛'],
    ['green_heart', '💚'], ['blue_heart', '💙'], ['purple_heart', '💜'],
    ['black_heart', '🖤'], ['white_heart', '🤍'], ['brown_heart', '🤎'],
    ['broken_heart', '💔'], ['two_hearts', '💕'], ['sparkling_heart', '💖'],
    ['heartpulse', '💗'], ['cupid', '💘'], ['gift_heart', '💝'], ['100', '💯'],
    ['anger', '💢'], ['boom', '💥'], ['dizzy', '💫'], ['sweat_drops', '💦'],
    ['dash', '💨'], ['hole', '🕳️'], ['check', '✅'], ['ballot_check', '☑️'],
    ['x', '❌'], ['cross_mark', '❎'], ['warning', '⚠️'], ['no_entry', '⛔'],
    ['prohibited', '🚫'], ['question', '❓'], ['exclamation', '❗'],
    ['grey_question', '❔'], ['bangbang', '‼️'], ['recycle', '♻️'],
    ['infinity', '♾️'], ['arrow_up', '⬆️'], ['arrow_down', '⬇️'],
    ['arrow_left', '⬅️'], ['arrow_right', '➡️'], ['repeat', '🔁'],
    ['shuffle', '🔀'], ['play', '▶️'], ['pause', '⏸️'], ['stop', '⏹️'],
    ['record', '⏺️'], ['fast_forward', '⏩'], ['rewind', '⏪'], ['plus', '➕'],
    ['minus', '➖'], ['divide', '➗'], ['glowing_star', '🌟'],
    ['eight_pointed', '✳️'], ['new', '🆕'], ['ok', '🆗'], ['up', '🆙'],
    ['cool', '🆒'], ['free', '🆓'], ['sos', '🆘'], ['recycling', '🔄'],
    ['radioactive', '☢️'], ['biohazard', '☣️'], ['peace', '☮️'],
    ['yin_yang', '☯️'], ['wheelchair', '♿'], ['recycle_bin', '🗑️'],
  ]],
]

export type Emoji = { name: string; glyph: string; group: string }

export const ALL_EMOJI: readonly Emoji[] = EMOJI_GROUPS.flatMap(
  ([group, list]) => list.map(([name, glyph]) => ({ name, glyph, group })),
)

/**
 * The table the renderer reads, so `:fire:` in a message becomes 🔥.
 *
 * The same rows the picker shows. Built once — a map rebuilt on every render
 * is a new object every time, which is enough to make everything downstream
 * of it redraw for no reason.
 */
export const BY_NAME: ReadonlyMap<string, string> = new Map(
  ALL_EMOJI.map((e) => [e.name, e.glyph]),
)

/**
 * What matches what somebody is typing.
 *
 * Names that *start* with it first, then names that merely contain it. Typing
 * "s" should offer smile before melting, and a plain `includes` puts them in
 * table order, which is no order at all from where somebody is sitting.
 */
export function searchEmoji(query: string): Emoji[] {
  const q = query.toLowerCase().trim()
  if (!q) return [...ALL_EMOJI]
  const starts: Emoji[] = []
  const contains: Emoji[] = []
  for (const e of ALL_EMOJI) {
    if (e.name.startsWith(q)) starts.push(e)
    else if (e.name.includes(q)) contains.push(e)
  }
  return [...starts, ...contains]
}

/** The matches, back in their groups, for a picker that shows headings. */
export function groupsFor(query: string): EmojiGroup[] {
  const hits = searchEmoji(query)
  const keep = new Set(hits.map((e) => e.name))
  const out: EmojiGroup[] = []
  for (const [group, list] of EMOJI_GROUPS) {
    const kept = list.filter(([name]) => keep.has(name))
    if (kept.length) out.push([group, kept])
  }
  return out
}
