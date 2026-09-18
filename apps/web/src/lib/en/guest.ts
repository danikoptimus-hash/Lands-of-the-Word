/** EN-строки области «guest» (вход, восстановление, новый пароль, приглашение, главная, аккаунт, новая игра). Ключ — русская строка как в коде. Добавлять только сюда; legacy.ts не трогать. */
export const GUEST: Record<string, string> = {
  // Вход и регистрация
  "Вход или регистрация": "Sign in or sign up",
  "Почта": "Email",
  "Почта нужна, чтобы восстановить пароль и получать уведомления.": "Email is needed to recover your password and receive notifications.",
  "Создать аккаунт": "Create account",
  "На почту придёт письмо со ссылкой: без подтверждения играть нельзя. Она же нужна, чтобы восстановить пароль.": "A confirmation link will be sent to this email: you cannot play until it is confirmed. It is also used to recover your password.",
  "Пришлём письмо со ссылкой — без неё играть нельзя. По этой почте восстанавливают пароль.": "We will send a link by e-mail — you cannot play until you open it. The same e-mail restores your password.",
  // Подтверждение почты
  "Подтверждение почты": "Email confirmation",
  "Почта подтверждена": "Email confirmed",
  "Подтвердите почту": "Confirm your email",
  "Войдите в аккаунт и запросите новое письмо: кнопка «Отправить ещё раз».": "Sign in and request a new message with the “Send again” button.",
  "Готово: почта подтверждена, можно играть.": "Done: your email is confirmed, you can play.",
  "К моим играм": "To my games",
  "Мы отправили письмо со ссылкой на": "We sent a message with a link to",
  "Откройте ссылку из письма — и эта страница сама сменится на игру.": "Open the link from the message and this page will switch to the game by itself.",
  "Не пришло — проверьте «Спам» или отправьте письмо ещё раз. Ссылка действует сутки.": "Nothing arrived? Check your spam folder or send the message again. The link is valid for 24 hours.",
  "Другая почта": "Another email",
  "Сохранить и выслать письмо": "Save and send the message",
  "Отправить ещё раз": "Send again",
  "Ошиблись в почте? Изменить": "Wrong email? Change it",
  "Нужна для восстановления пароля и уведомлений. Новую почту нужно будет подтвердить по ссылке из письма.": "Needed for password recovery and notifications. A new email must be confirmed via the link in the message.",
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
  "Для писем и восстановления пароля. Новую почту подтвердите по ссылке из письма.": "For e-mails and password recovery. Confirm a new e-mail via the link we send.",
  "Ссылка для сброса пароля": "Password reset link",
};
