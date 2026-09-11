/** EN-строки области «guest» (вход, восстановление, новый пароль, приглашение, главная, аккаунт, новая игра). Ключ — русская строка как в коде. Добавлять только сюда; legacy.ts не трогать. */
export const GUEST: Record<string, string> = {
  // Вход и регистрация
  "Вход или регистрация": "Sign in or sign up",
  "Почта": "Email",
  "Почта нужна, чтобы восстановить пароль и получать уведомления.": "Email is needed to recover your password and receive notifications.",
  "Создать аккаунт": "Create account",
  "Ко входу": "Back to sign in",
  // Восстановление пароля
  "Письмо отправлено": "Email sent",
  "Ссылка действует час. Не пришло — проверьте «Спам».": "The link is valid for one hour. Nothing arrived? Check your spam folder.",
  "Почты в аккаунте не было?": "No email on the account?",
  "Создайте новый аккаунт и попросите капитана прислать приглашение в команду.": "Create a new account and ask your captain to send a team invitation.",
  "Отправка писем на сервере пока не настроена, восстановить пароль сейчас нельзя. Обратитесь к администратору игры.": "Email is not set up on the server yet, so the password cannot be recovered right now. Contact the game administrator.",
  "Пришлём ссылку на почту, указанную в аккаунте.": "We will send a link to the email listed in your account.",
  // Новый пароль
  "Повторите пароль": "Repeat password",
  // Приглашение
  "Приглашение в команду": "Team invitation",
  "Попросите у капитана новую ссылку-приглашение.": "Ask your captain for a new invitation link.",
  "На главную": "Home",
  "Вы уже в команде «{name}» этой игры.": "You are already in the team “{name}” of this game.",
  "Открыть карту": "Open the map",
  // Главная
  "команда": "team", "команды": "teams",
  "Вас ещё не пригласили в команду. Попросите у капитана ссылку-приглашение.": "You have not been invited to a team yet. Ask your captain for an invitation link.",
  // Новая игра
  "Церковь": "Church",
  "Карту, старты и остальное настроите на странице игры.": "The map, starts and everything else are set up on the game page.",
  // Аккаунт
  "суперадмин": "superadmin",
  "нельзя изменить": "cannot be changed",
  "Имя в команде": "Name in the team",
  "Нужна для восстановления пароля и уведомлений.": "Needed for password recovery and notifications.",
  "Ссылка для сброса пароля": "Password reset link",
};
