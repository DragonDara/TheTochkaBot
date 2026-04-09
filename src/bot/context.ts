import type { PayrollSettlementColumnD } from '#root/bot/helpers/payroll-user-calendar-d.js'
import type { Config } from '#root/config.js'
import type { Logger } from '#root/logger.js'
import type { SheetsRepo } from '#root/repos/sheets-repo.js'
import type { AutoChatActionFlavor } from '@grammyjs/auto-chat-action'
import type { ConversationFlavor } from '@grammyjs/conversations'
import type { HydrateFlavor } from '@grammyjs/hydrate'
import type { I18nFlavor } from '@grammyjs/i18n'
import type { ParseModeFlavor } from '@grammyjs/parse-mode'
import type { Context as DefaultContext, SessionFlavor } from 'grammy'

export interface SessionData {
  /** Сообщение пользователя «Запросить зарплату» с прошлого входа в поток — удалить при следующем. */
  previousPayrollRequestUserMessageId?: number
  /** Пользователь «запрос зарплаты»: только 🟢; дни включаются/снимаются по одному клику. */
  userCustomCalendar?: {
    calendarYear: number
    calendarMonth: number
    calendarChatId: number
    calendarMessageId: number
    /** Сообщение «Действия:» с reply-клавиатурой Сохранить/Сбросить/… */
    actionsHintMessageId?: number
    /** Последняя пара «Сохранить» (пользователь) + «Сохранено.» (бот) — удалить при следующем «Сохранить». */
    lastSaveAckPair?: { userMessageId: number, botMessageId: number }
    /** Уже сохранённые дни (🟢 не кликабельны до «Сбросить»; после одобрения — ✅+число, клик без эффекта). */
    lockedSavedDayKeys: string[]
    /** Текущий черновик: отмеченные кликом дни (вне locked). */
    draftSelectedKeys: string[]
    /** Строка на листе JSON Calendar (A = telegram_id), для чтения/очистки колонки C. */
    jsonCalendarSheetRow?: number | null
    /** Строки Payment History после «Сохранить» в этой сессии (удаление при «Сбросить» снизу вверх). */
    paymentHistorySheetRows: number[]
    /** Решение сотрудника по последнему запросу (лист JSON Calendar, колонка D). */
    payrollSettlement?: PayrollSettlementColumnD
  }
}

interface ExtendedContextFlavor {
  logger: Logger
  config: Config
  sheetsRepo: SheetsRepo
}

export type Context = ConversationFlavor<
  ParseModeFlavor<
    HydrateFlavor<
      DefaultContext &
      ExtendedContextFlavor &
      SessionFlavor<SessionData> &
      I18nFlavor &
      AutoChatActionFlavor
    >
  >
>
