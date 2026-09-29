// Encryption for the shared data file: PBKDF2-SHA256 (600k rounds) → AES-GCM-256.
// The file on GitHub is unreadable without the passphrase; the passphrase never leaves the phone.

export const KDF_ITER = 600000;
const te = new TextEncoder(), td = new TextDecoder();

export function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s) {
  const bin = atob(String(s).replace(/\s+/g, ''));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
export const utf8 = (s) => te.encode(s);
export const fromUtf8 = (u8) => td.decode(u8);

export function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

export async function deriveKey(passphrase, salt, iter = KDF_ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function pipe(u8, stream) {
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());
}
const canGzip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

/** Encrypt a JSON-able object into the file format stored on GitHub. */
export async function sealJSON(obj, key, salt, iter = KDF_ITER) {
  let plain = te.encode(JSON.stringify(obj));
  const gz = canGzip();
  if (gz) plain = await pipe(plain, new CompressionStream('gzip'));
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { app: 'coin-master', v: 1, kdf: { name: 'PBKDF2-SHA256', iter, salt: b64(salt) }, iv: b64(iv), gz, data: b64(ct) };
}

export class WrongPassphrase extends Error {}

/** Decrypt the GitHub file. Throws WrongPassphrase if the key does not fit. */
export async function openJSON(file, key) {
  if (!file || file.app !== 'coin-master' || !file.data) throw new Error('This is not a Coin Master data file');
  let plain;
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(file.iv) }, key, unb64(file.data)));
  } catch {
    throw new WrongPassphrase('Wrong passphrase');
  }
  if (file.gz) {
    if (!canGzip()) throw new Error('This browser is too old to open the data (needs iOS 16.4 or newer).');
    plain = await pipe(plain, new DecompressionStream('gzip'));
  }
  return JSON.parse(td.decode(plain));
}

export function fileSalt(file) { return unb64(file.kdf.salt); }
export function fileIter(file) { return file.kdf.iter || KDF_ITER; }

// Six words from a 512-word list ≈ 54 bits, plus 600k PBKDF2 rounds: easy to type, hard to guess.
const WORDS = (
  'able acid acorn actor adapt agent alarm album alert alley alpha amber anchor angle ankle apple april arena arrow atlas attic aunt autumn avocado ' +
  'bacon badge bagel baker balcony bamboo banana banjo barrel basil basket beach beard beaver bench berry bicycle bingo birch biscuit bison blanket ' +
  'blossom blue boat bonnet book boot bottle bounce brass bread breeze brick bridge brook broom bubble bucket buffalo bugle bundle bunny butter button ' +
  'cabin cactus cake camel camera candle canoe canvas canyon carbon cargo carpet carrot castle cedar cello chalk cherry chess chimney cider cinema ' +
  'circus citrus clay cliff clock cloud clover coast cobalt cocoa comet copper coral cotton cousin crab crane crayon cream cricket crown crystal ' +
  'cupcake curtain cushion daisy dance delta denim desert diary dinner dolphin donkey dragon drawer dream drum duck dune eagle easel echo ' +
  'elbow elder ember emerald engine falcon fancy feather fence fern ferry fiddle field fig finch flame flannel flute fog forest fossil fountain ' +
  'fox fridge frog frost fudge galaxy garden garlic gazelle gecko giant ginger giraffe glacier glove goat golden gondola goose gorilla grape ' +
  'gravel guitar gull hammock harbor harp hazel hedge helmet heron hill hippo honey hoodie horizon hotel husky igloo indigo iris island ivory ' +
  'jacket jaguar jam jasmine jelly jewel jigsaw jungle kayak kettle kitten kiwi koala ladder lagoon lake lantern lapel laptop lava lemon leopard ' +
  'lettuce library lilac lime linen lion lizard llama lobster locket lotus lunar lynx magnet mango maple marble market meadow melon meteor ' +
  'mint mirror mitten mocha monkey moose mosaic moss motor muffin museum mustard napkin nectar needle nest nickel noodle nutmeg oasis ocean ' +
  'olive onion opal orange orbit orchid otter oven owl oyster paddle pagoda palace panda panther paper parade parrot pasta peach peanut pearl ' +
  'pebble pelican pencil pepper piano pickle pigeon pillow pine pirate pizza planet plum pocket polar pony poppy potato prairie pretzel prism ' +
  'puffin pumpkin puppet puzzle quail quartz quilt rabbit raccoon radar radio raft rain raisin ramp raven reef ribbon rice river robin rocket ' +
  'rose ruby saddle saffron sail salad salmon sand sapphire satin scarf school scooter seal season shadow shell shore silk silver sketch sled ' +
  'slipper snail snow soap sofa sonnet soup spark sparrow spice spider spinach sponge spoon spring spruce squash squid stable star statue ' +
  'stone storm straw stream sugar summit sunset swan sweater swing table tablet taco tango teapot temple tennis thistle thunder tiger timber ' +
  'toast tomato topaz torch tortoise towel tower tractor trail train trumpet tulip tuna tunnel turkey turnip turtle tuxedo umbrella unicorn ' +
  'valley vanilla velvet violet violin volcano waffle wagon walnut walrus wand wave whale wheat whistle willow window winter wizard wolf wool ' +
  'yacht yarn yogurt zebra zenith zephyr zinc zipper zucchini acre agile alloy anvil apron aqua aroma ash aspen atom axle bay beacon bell ' +
  'blade bolt bone brave brisk buckle cable cape cart chain chip chord cider civic clamp cliffside cocoon cone cove crisp cube dawn deer dew ' +
  'dock dove drift dusk dust elm fable fawn fiber flag flint flock foam forge frame gale gem glade glow grain grove gust haven hawk hay ' +
  'heart hinge hive hook horn inch ink jade jolly keel kelp kite knot lace lark leaf ledge lens lever light lily loom lute mane maze mesa ' +
  'mist moth mule nook oak oar onyx orca palm path peak pier plank pond quest ridge rope rover rune rust sage scout shade shelf shrub skiff ' +
  'slate sloop sprout stem stork swift thorn tide trout twig vale vane vine wren yak yew'
).split(/\s+/);

export function suggestPassphrase(n = 6) {
  const list = [...new Set(WORDS)];
  const r = crypto.getRandomValues(new Uint32Array(n));
  return Array.from(r, x => list[x % list.length]).join('-');
}

export function passphraseStrength(p) {
  if (!p) return { ok: false, label: 'Enter a passphrase' };
  const words = p.split(/[\s\-_.]+/).filter(Boolean).length;
  if (p.length < 12) return { ok: false, label: 'Too short: use at least 12 characters (4+ words is easiest)' };
  if (words >= 5 || p.length >= 24) return { ok: true, label: 'Strong' };
  return { ok: true, label: 'OK. More words make it stronger' };
}
