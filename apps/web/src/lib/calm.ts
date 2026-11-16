/**
 * Игрок сейчас занят: печатает или держит открытым лист, окно, подтверждение. В такой момент страницу не перезагружают
 * на новую версию (решение владельца 16.11) и не пересоздают экран при смене языка. Открытый раздел нижней панели
 * занятостью не считается: раздел, открытый город и положение карты запоминаются и возвращаются.
 */
export function pageBusy(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable)) return true;
  return Boolean(document.querySelector('[role="dialog"]:not(.side-menu), [role="alertdialog"]'));
}
