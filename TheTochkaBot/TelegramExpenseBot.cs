// Требуемые NuGet пакеты:
// - Google.Apis.Sheets.v4
// - Telegram.Bot

using Google.Apis.Auth.OAuth2;
using Google.Apis.Services;
using Google.Apis.Sheets.v4;
using Google.Apis.Sheets.v4.Data;
using Telegram.Bot;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;
using Telegram.Bot.Polling;
using System.Globalization;
using System.Text.RegularExpressions;

public class TelegramExpenseBot
{
    private readonly ITelegramBotClient _botClient;
    private readonly SheetsService _sheetsService;
    private readonly string _spreadsheetId;
    private readonly Regex _expenseRegex = new(@"^(.+?)\s+(\d+(\.\d{1,2})?)$", RegexOptions.IgnoreCase);
    private readonly ExpenseReportService _expenseReportService;
    private readonly string _botUsername = "the_tochka_expenditures_bot";

    public TelegramExpenseBot(string telegramBotToken, string spreadsheetId, GoogleCredential credential)
    {
        _botClient = new TelegramBotClient(telegramBotToken);
        _spreadsheetId = spreadsheetId;
        _sheetsService = new SheetsService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "Telegram Expense Bot",
        });
        _expenseReportService = new ExpenseReportService(_sheetsService, _spreadsheetId);
    }

    public void Start()
    {
        var receiverOptions = new ReceiverOptions
        {
            AllowedUpdates = new UpdateType[] { UpdateType.Message }
        };

        _botClient.StartReceiving(
            HandleUpdateAsync,
            HandleErrorAsync,
            receiverOptions
        );
    }

    private async Task HandleUpdateAsync(ITelegramBotClient bot, Update update, CancellationToken token)
    {
        if (update.Message is not { Text: { } messageText }) return;
        string trimmed = messageText.Trim();
        if (trimmed.Equals("/weaklyreport", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals($"/weaklyreport@{_botUsername}", StringComparison.OrdinalIgnoreCase))
        {
            string report = await _expenseReportService.GetWeeklyReportAsync();
            await _botClient.SendMessage(
                chatId: update.Message.Chat.Id,
                text: report,
                cancellationToken: token
            );
            return;
        }
        if (trimmed.Equals("/monthlyreport", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals($"/monthlyreport@{_botUsername}", StringComparison.OrdinalIgnoreCase))
        {
            string report = await _expenseReportService.GetMonthlyReportAsync();
            await _botClient.SendMessage(
                chatId: update.Message.Chat.Id,
                text: report,
                cancellationToken: token
            );
            return;
        }

        var match = _expenseRegex.Match(messageText);
        if (!match.Success)
        {
            await _botClient.SendMessage(
            chatId: update.Message.Chat.Id,
            text: "Пожалуйста, введите расход в формате: <категория> <сумма> (например: Продукты 500) или <категория> <сумма> <имя сотрудника> для 'Под ЗП'",
            cancellationToken: token
            );
            return;
        }

        string category = CultureInfo.CurrentCulture.TextInfo.ToTitleCase(match.Groups[1].Value.ToLower());
        string amount = match.Groups[2].Value;
        string date = update.Message.Date.ToLocalTime().ToString("yyyy-MM-dd");
        string description = "";

        // Special case for 'Под ЗП'
        if (category.Equals("Под ЗП", StringComparison.OrdinalIgnoreCase))
        {
            var parts = messageText.Trim().Split(' ', 3, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 3)
                description = parts[2];
        }

        string monthSheetName = update.Message.Date.ToLocalTime().ToString("MMMM yyyy", new CultureInfo("ru-RU"));

        await EnsureSheetExistsAsync(monthSheetName);

        var valueRange = new ValueRange
        {
            Values = new List<IList<object>> { new List<object> { category, amount, date, description } }
        };

        var appendRequest = _sheetsService.Spreadsheets.Values.Append(valueRange, _spreadsheetId, $"{monthSheetName}!A:D");
        appendRequest.ValueInputOption = SpreadsheetsResource.ValuesResource.AppendRequest.ValueInputOptionEnum.USERENTERED;
        await appendRequest.ExecuteAsync();

        // Send confirmation message to user (Telegram.Bot v22+)
        await _botClient.SendMessage(
            chatId: update.Message.Chat.Id,
            text: $"Расход успешно добавлен: {category} - {amount}kzt ({date})" + (string.IsNullOrWhiteSpace(description) ? "" : $" для сотрудника: {description}"),
            cancellationToken: token
        );
    }

    private Task HandleErrorAsync(ITelegramBotClient bot, Exception exception, CancellationToken token)
    {
        Console.WriteLine($"Ошибка: {exception.Message} {exception.StackTrace}");
        return Task.CompletedTask;
    }

    private async Task EnsureSheetExistsAsync(string sheetName)
    {
        var spreadsheet = await _sheetsService.Spreadsheets.Get(_spreadsheetId).ExecuteAsync();
        if (spreadsheet.Sheets.Any(s => s.Properties.Title == sheetName))
            return;

        var addSheetRequest = new AddSheetRequest
        {
            Properties = new SheetProperties { Title = sheetName }
        };

        var batchUpdateRequests = new List<Request>
        {
            new Request { AddSheet = addSheetRequest }
        };

        await _sheetsService.Spreadsheets.BatchUpdate(new BatchUpdateSpreadsheetRequest
        {
            Requests = batchUpdateRequests
        }, _spreadsheetId).ExecuteAsync();

        var headerRange = new ValueRange
        {
            Values = new List<IList<object>> { new List<object> { "Тип расхода", "Сумма", "Дата", "Описание" } }
        };
        var update = _sheetsService.Spreadsheets.Values.Update(headerRange, _spreadsheetId, $"{sheetName}!A1:D1");
        update.ValueInputOption = SpreadsheetsResource.ValuesResource.UpdateRequest.ValueInputOptionEnum.USERENTERED;
        await update.ExecuteAsync();

        // Add filter to the first row (A1:D1)
        var filterRequest = new Request
        {
            SetBasicFilter = new SetBasicFilterRequest
            {
                Filter = new BasicFilter
                {
                    Range = new GridRange
                    {
                        SheetId = GetSheetIdByName(spreadsheet, sheetName),
                        StartRowIndex = 0,
                        EndRowIndex = 1,
                        StartColumnIndex = 0,
                        EndColumnIndex = 4
                    }
                }
            }
        };
        await _sheetsService.Spreadsheets.BatchUpdate(new BatchUpdateSpreadsheetRequest
        {
            Requests = new List<Request> { filterRequest }
        }, _spreadsheetId).ExecuteAsync();
    }

    private int? GetSheetIdByName(Spreadsheet spreadsheet, string sheetName)
    {
        var sheet = spreadsheet.Sheets.FirstOrDefault(s => s.Properties.Title == sheetName);
        return sheet?.Properties.SheetId;
    }
}


