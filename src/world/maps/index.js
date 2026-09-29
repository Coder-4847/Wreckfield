import { YARD } from './yard.js';
import { HARBOR } from './harbor.js';
import { QUARRY } from './quarry.js';
import { ALPINE } from './alpine.js';
import { DOWNTOWN } from './downtown.js';

// Playable maps, in menu order. Each is a definition object consumed by world/Arena.js (see Arena.build).
export const MAPS = { yard: YARD, harbor: HARBOR, quarry: QUARRY, alpine: ALPINE, downtown: DOWNTOWN };
export const MAP_KEYS = Object.keys(MAPS);
export const DEFAULT_MAP = 'yard';
