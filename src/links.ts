// Every web address the built site may hold. The page opens none of them by itself: each is a link the
// person can click, except the last, which is only a name. src/build.test.ts builds the site and fails
// on any address that is not in this list.

import { SOURCE_LINKS } from './model/assumptions';
import { PROVIDER_LINKS } from './model/contribute';
import { PLACE_LINKS } from './model/places';

/** "Source on GitHub", in the header and the footer of index.html. */
export const SOURCE_CODE = 'https://github.com/squaloo-studio/ai-co2';

/** Not a link and never requested: the page needs this exact text to create its icons. */
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export const ALLOWED_ADDRESSES: readonly string[] = Object.freeze([...PROVIDER_LINKS, SOURCE_CODE, ...SOURCE_LINKS, ...PLACE_LINKS, SVG_NAMESPACE]);
