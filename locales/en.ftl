## Commands

start =
    .description = Start the bot
language =
    .description = Change language
setcommands =
    .description = Set bot commands
payroll =
    .description = Export iikoServer payroll slice to Google Sheet (date YYYY-MM-DD)

## Welcome Feature

welcome = Welcome!
salary-btn-request = Request payroll
timesheet-btn-fill = Fill timesheet
timesheet-save-no-row = Could not save: there is no Timesheet row with month «{ $month }» and your nickname in column B.
timesheet-save-error = Could not write the timesheet to Google Sheets.
timesheet-reset-ok = Timesheet reset.
timesheet-reset-blocked-approved = You can't reset a timesheet that has already been approved.
timesheet-month-already-approved-alert = Your timesheet for these days has already been approved.
timesheet-anchor-other-month-alert = You are already filling the timesheet for another month.
accountant-notify-timesheet-saved = { $position } { $fio } saved the timesheet for { $months }.
accountant-notify-timesheet-reset = { $position } { $fio } reset the timesheet for { $months }.
accountant-notify-payroll-period = { $position } { $fio } requested payroll for { $period }.
accountant-notify-payroll-reset = { $position } { $fio } reset payroll for { $period }.
user-notify-timesheet-approved = Your timesheet for { $month } has been approved.
user-notify-timesheet-rejected = Your timesheet for { $month } has not been approved.
user-notify-payroll-approved = Your payroll for { $period } has been approved.
user-notify-payroll-rejected = Your payroll for { $period } has not been approved.
salary-request-no-username = Set a public Telegram username in your profile settings — the sheet matches you by @username, not by numeric id.
salary-request-not-found = Your name is not in the list.
salary-request-error = Can't request payroll right now.
user-request-custom-prompt = Select days — tap each date you need (🟡/✔️ - day shift, 🔵/☑️ - evening shift, 🟠/🔘 - day and evening shift)
user-request-custom-actions-hint = Actions:
user-btn-request-week = Request for a week
user-calendar-c-save-ok = Saved.
user-calendar-c-save-error = Could not write to the sheet.
user-calendar-c-save-no-row = Could not save: user could not be determined.
user-calendar-c-save-no-users-row = Calendar saved, but your row was not found on the Users sheet (check @username in column A).
user-calendar-users-ed-invalid = Could not calculate the amount: check columns D and E on the Users sheet (D must not be 0).
user-calendar-c-reset-sheet-error = Calendar reset, but the sheet cell could not be cleared.
user-calendar-save-empty-draft = Select at least one day on the calendar, then tap Save.
user-calendar-week-no-free-days = No days to choose from.
user-calendar-settled-day-alert = You've got your payment for these days already  
user-calendar-payroll-already-submitted-alert = You've already submitted a request for these days.
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

## Payroll slice (iikoServer → Sheet)

payroll-slice-usage = Send <code>/payroll YYYY-MM-DD</code> (iiko session oklad for that date).
payroll-slice-forbidden = You don’t have access to this command.
payroll-slice-started = Getting payroll for { $date } from iikoServer…
payroll-slice-ok = Done. Appended { $rows } rows to Payroll for { $date }.
payroll-slice-skipped = Skipped: { $reason }.
payroll-slice-noop = Not run: { $reason }.
payroll-slice-error = iiko or Sheets request failed. Check logs and credentials.

## Employee Feature

employee-btn-users = Users
employee-btn-requested-payrolls = Requested payrolls
employee-btn-requested-timesheets = Requested timesheets
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
employee-requested-timesheets-empty = No timesheets pending approval.
employee-requested-timesheets-read-error = Could not read the Timesheet sheet ({ $range }). Check `SHEETS_TIMESHEET_RANGE`.
employee-requested-timesheets-done = Done.
employee-timesheet-approve-question = Approve timesheet?
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
