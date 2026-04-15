## Commands

start =
    .description = Запускает бота
language =
    .description = Изменяет язык
setcommands =
    .description = Создает команды для бота

## Welcome Feature

welcome = Добро пожаловать!
salary-btn-request = Запросить зарплату
timesheet-btn-fill = Заполнить табель
timesheet-save-no-row = Не удалось сохранить: на листе Timesheet нет строки с месяцем «{ $month }» и вашим никнеймом в колонке B.
timesheet-save-error = Не удалось записать табель в Google Таблицу.
timesheet-reset-ok = Табель сброшен.
timesheet-reset-blocked-approved = Нельзя сбросить уже одобренный табель.
timesheet-month-already-approved-alert = Ваш табель за эти дни уже одобрен.
timesheet-anchor-other-month-alert = Вы уже заполняете табель для другого месяца.
accountant-notify-timesheet-saved = { $position } { $fio } заполнил табель за { $months }.
accountant-notify-timesheet-reset = { $position } { $fio } сбросил табель за { $months }.
accountant-notify-payroll-period = { $position } { $fio } запросил зарплату за { $period }.
accountant-notify-payroll-reset = { $position } { $fio } сбросил зарплату за { $period }.
salary-request-no-username = Укажите публичный никнейм в настройках Telegram — в таблице сопоставление идёт по @username, а не по числовому id.
salary-request-not-found = Вашего имени нет в списке.
salary-request-error = Сейчас не могу запросить зарплату.
user-request-custom-prompt = Выберите дни — нажмите на каждую нужную дату (🟡/✔️ - дневная смена, 🔵/☑️ - вечерняя смена, 🟠/🔘 - дневная и вечерняя смена)
user-request-custom-actions-hint = Действия:
user-btn-request-week = Запросить за неделю
user-calendar-c-save-ok = Сохранено.
user-calendar-c-save-error = Не удалось записать в таблицу.
user-calendar-c-save-no-row = Не удалось сохранить: не удалось определить пользователя.
user-calendar-c-save-no-users-row = Календарь сохранён, но строка на листе Users не найдена (проверьте @username в колонке A).
user-calendar-users-ed-invalid = Не удалось посчитать сумму: проверьте столбцы D и E на листе Users (D не должен быть 0).
user-calendar-c-reset-sheet-error = Календарь сброшен, но не удалось очистить ячейку в таблице.
user-calendar-save-empty-draft = Сначала отметьте хотя бы один день на календаре, затем нажмите «Сохранить».
user-calendar-week-no-free-days = Нет дней для выбора.
user-calendar-settled-day-alert = Вы уже получили оплату за эти дни.
user-calendar-payroll-already-submitted-alert = Вы уже подали запрос за эти дни.
calendar-weekday-mon = Пн
calendar-weekday-tue = Вт
calendar-weekday-wed = Ср
calendar-weekday-thu = Чт
calendar-weekday-fri = Пт
calendar-weekday-sat = Сб
calendar-weekday-sun = Вс

## Language Feature

language-select = Пожалуйста, выберите ваш язык
language-changed = Язык был успешно изменён!
keyboard-refreshed = Подписи на кнопках обновлены.

## Admin Feature

admin-commands-updated = Команды обновлены.

## Employee Feature

employee-btn-users = Пользователи
employee-btn-requested-payrolls = Запрошенные зарплаты
employee-btn-requested-timesheets = Запрошенные табели
employee-btn-distribute-save = Сохранить
employee-btn-distribute-reset = Сбросить изменения
employee-btn-back = Отмена
employee-distribute-calendar-prompt = Календарь по выбранному сотруднику. Листайте месяцы стрелками.
employee-distribute-limit-f-exceeded = Нельзя выбрать больше { $max } дней.
employee-distribute-f-invalid = В столбце F нет допустимого числа; выбор дней недоступен.
employee-distribute-actions-hint = Действия:
employee-distribute-exited = Режим распределения закрыт.
employee-distribute-save-ok = Сохранено.
employee-distribute-save-error = Не удалось записать в Google Таблицу.
employee-distribute-save-no-telegram = В строке листа не найден telegram_id (колонка A).
employee-users-empty = Список пользователей пуст.
employee-user-number-invalid = Пожалуйста, отправьте корректный номер пользователя из списка.
employee-user-selected = Выбран пользователь: { $userId }
employee-back-to-users = Назад. Снова выберите номер пользователя.
employee-requested-payrolls-empty = Пока нет запросов на зарплату.
employee-requested-payrolls-read-error = Не могу прочитать диапазон Google Sheets "{ $range }". Проверь имя листа и переменную `SHEETS_PAYMENT_HISTORY_RANGE` (или `SHEETS_PAYROLL_REQUESTS_RANGE` для других экранов).
employee-requested-payrolls-done = Готово.
employee-requested-timesheets-empty = Пока нет табелей на одобрение.
employee-requested-timesheets-read-error = Не могу прочитать лист Timesheet ({ $range }). Проверь `SHEETS_TIMESHEET_RANGE`.
employee-requested-timesheets-done = Готово.
employee-timesheet-approve-question = Одобрить табель?
employee-users-list-done = Готово.
employee-user-distribute-days = Распределить дни
employee-approve-question = Одобрить зарплату?
employee-approve-already-handled = Уже обработано.
employee-approve-yes = Да
employee-approve-no = Нет
employee-approve-saved = Сохранено.
employee-approve-error = Сейчас не могу сохранить.
employee-approve-message-yes = Зарплата одобрена для { $fio }.
employee-approve-message-no = Зарплата не одобрена для { $fio }.

## Unhandled Feature

unhandled = Неопознанная команда. Попробуйте /start
