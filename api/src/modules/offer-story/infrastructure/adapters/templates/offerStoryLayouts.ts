import type { StoryLayoutBuilder } from './storyLayoutModel';
import { blueBurst } from './layouts/blueBurst';
import { cleanLight } from './layouts/cleanLight';
import { flashNight } from './layouts/flashNight';
import { freshMint } from './layouts/freshMint';
import { goldNeon } from './layouts/goldNeon';
import { hotDeal } from './layouts/hotDeal';
import { newsViolet } from './layouts/newsViolet';
import { pinkWeek } from './layouts/pinkWeek';

/**
 * Um layout por id de `OFFER_STORY_TEMPLATES`, cada um com identidade própria (um arquivo em
 * `layouts/`). Peças comuns (foto, preço, selo, cupom, chamada do link) em `storyParts.ts`.
 */
export const OFFER_STORY_LAYOUTS: Readonly<Record<string, StoryLayoutBuilder>> = {
  'flash-night': flashNight,
  'blue-burst': blueBurst,
  'pink-week': pinkWeek,
  'gold-neon': goldNeon,
  'fresh-mint': freshMint,
  'hot-deal': hotDeal,
  'clean-light': cleanLight,
  'news-violet': newsViolet,
};
