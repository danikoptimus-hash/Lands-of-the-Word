import { Component, type ReactNode } from "react";
import { t } from "../lib/i18n";

/**
 * Граница ошибок (ревизия 15.11). Без неё любой сбой при отрисовке — неожиданный ответ сервера, старая вкладка после
 * выкладки — убирал с экрана всё приложение: игрок видел пустую страницу без объяснения. Теперь — короткое сообщение
 * и кнопка «Обновить».
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  componentDidCatch(error: unknown): void { console.error("Сбой отрисовки", error); }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="container" role="alert">
        <p>{t("Что-то пошло не так. Обновите страницу — данные игры не пропали.")}</p>
        <div className="actions"><button type="button" onClick={() => location.reload()}>{t("Обновить")}</button></div>
      </div>
    );
  }
}
