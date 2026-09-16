import { LEGACY } from "./en/legacy";
import { COMMON } from "./en/common";
import { GUEST } from "./en/guest";
import { PLAYER } from "./en/player";
import { ADMIN } from "./en/admin";
import { CHANGELOG_EN } from "./en/changelog";

/** Словарь EN: legacy (старые строки) + модули по областям; поздние перекрывают ранние. */
export const EN: Record<string, string> = { ...LEGACY, ...COMMON, ...GUEST, ...PLAYER, ...ADMIN, ...CHANGELOG_EN };
