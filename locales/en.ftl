## Commands

start =
    .description = Start the bot
language =
    .description = Change language
setcommands =
    .description = Set bot commands

## Welcome Feature

welcome = Welcome!
salary-btn-request = Request payroll
timesheet-btn-fill = Fill timesheet
salary-request-no-username = Set a public Telegram username in your profile settings — the sheet matches you by @username, not by numeric id.
salary-request-not-found = Your name is not in the list.
salary-request-error = Can't request payroll right now.
user-request-custom-prompt = Select days — tap each date you need (tap again to deselect)
user-request-custom-actions-hint = Actions:
user-btn-request-week = Request for a week
user-calendar-c-save-ok = Saved.
user-calendar-c-save-error = Could not write to the sheet.
user-calendar-c-save-no-row = Could not save: user could not be determined.
user-calendar-c-save-no-users-row = Calendar saved, but your row was not found on the Users sheet (check @username in column A).
user-calendar-users-ed-invalid = Could not calculate the amount: check columns D and E on the Users sheet (D must not be 0).
user-calendar-c-reset-sheet-error = Calendar reset, but the sheet cell could not be cleared.
user-calendar-save-empty-draft = Select at least one day on the calendar, then tap Save.
user-calendar-week-no-free-days = All days in this week are already saved. Choose other days or reset.
user-calendar-settled-day-alert = You've got your payment for these days already  
calendar-weekday-mon = Mon
calendar-weekday-tue = Tue
calendar-weekday-wed = Wed
calendar-weekday-thu = Thu
calendar-weekday-fri = Fri
calendar-weekday-sat = Sat
calendar-weekday-sun = Sun

## Language Feature

language-select = Please, select your language
language-changed = Language successfully changed!
keyboard-refreshed = Button labels updated.

## Admin Feature

admin-commands-updated = Commands updated.

## Employee Feature

employee-btn-users = Users
employee-btn-requested-payrolls = Requested payrolls
employee-btn-distribute-save = Save
employee-btn-distribute-reset = Discard changes
employee-btn-back = Cancel
employee-distribute-calendar-prompt = Calendar for the selected employee. Use arrows to change the month.
employee-distribute-limit-f-exceeded = You can't select more than { $max } days.
employee-distribute-f-invalid = Column F has no valid number; day selection is disabled.
employee-distribute-actions-hint = Actions:
employee-distribute-exited = Distribute mode closed.
employee-distribute-save-ok = Saved.
employee-distribute-save-error = Could not write to Google Sheets.
employee-distribute-save-no-telegram = No telegram_id in sheet row (column A).
employee-users-empty = No users configured.
employee-user-number-invalid = Please send a valid user number from the list.
employee-user-selected = Selected user: { $userId }
employee-back-to-users = Back. Pick a user number again.
employee-requested-payrolls-empty = No payroll requests yet.
employee-requested-payrolls-read-error = Can't read Google Sheets range "{ $range }". Check the sheet name and `SHEETS_PAYMENT_HISTORY_RANGE` (or `SHEETS_PAYROLL_REQUESTS_RANGE` for other screens).
employee-requested-payrolls-done = Done.
employee-users-list-done = Done.
employee-user-distribute-days = Distribute days
employee-approve-question = Approve payroll?
employee-approve-already-handled = Already handled.
employee-approve-yes = Yes
employee-approve-no = No
employee-approve-saved = Saved.
employee-approve-error = Can't save right now.
employee-approve-message-yes = Payroll approved for { $fio }.
employee-approve-message-no = Payroll not approved for { $fio }.

## Unhandled Feature

unhandled = Unrecognized command. Try /start
