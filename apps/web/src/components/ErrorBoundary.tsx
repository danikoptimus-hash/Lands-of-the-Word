import { Component, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { purgeSnaps } from "../lib/persist";

/** Не загрузился отдельный файл программы (страница «Что нового», экран администратора): дело в связи, а не в данных. */
export function isChunkError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Unable to preload CSS|error loading dynamically/i.test(text);
}

/**
 * Граница ошибок (ревизия 15.11). Без неё любой сбой при отрисовке — неожиданный ответ сервера, старая вкладка после
 * выкладки — убирал с экрана всё приложение: игрок видел пустую страницу без объяснения. Теперь — короткое сообщение
 * и кнопка «Обновить».
 * `part` — граница вокруг одной страницы (Layout): сбой страницы не убирает шапку; при переходе на другую страницу
 * граница сбрасывается (её ключ — адрес).
 */
export class ErrorBoundary extends Component<{ children: ReactNode; part?: boolean }, { failed: false | "error" | "chunk" }> {
  state: { failed: false | "error" | "chunk" } = { failed: false };
  static getDerivedStateFromError(error: unknown): { failed: "error" | "chunk" } { return { failed: isChunkError(error) ? "chunk" : "error" }; }
  componentDidCatch(error: unknown): void {
    console.error("Сбой отрисовки", error);
    // Сбой мог вызвать запомненный с прошлого запуска ответ (lib/persist.ts): стираем запомненное, чтобы «Обновить» начало
    // с ответов сервера, а не с того же снимка. Вход при этом остаётся — он в cookie.
    // Не загрузился файл программы — запомненное ни при чём: стирать его нельзя, иначе после «Обновить» без связи вместо
    // карты с прошлого раза игрок увидел бы «Нет связи» (нашёл независимый разбор 16.11).
    if (!isChunkError(error)) purgeSnaps();
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={this.props.part ? undefined : "container"} role="alert">
        <p>{this.state.failed === "chunk" ? t("Страница не загрузилась: нет связи с сервером. Проверьте связь и обновите страницу.") : t("Что-то пошло не так. Обновите страницу — данные игры не пропали.")}</p>
        <div className="actions"><button type="button" onClick={() => location.reload()}>{t("Обновить")}</button></div>
      </div>
    );
  }
}
