using Google.Apis.Sheets.v4;
using Google.Apis.Sheets.v4.Data;
using System.Globalization;

public class ExpenseReportService
{
    private readonly SheetsService _sheetsService;
    private readonly string _spreadsheetId;

    public ExpenseReportService(SheetsService sheetsService, string spreadsheetId)
    {
        _sheetsService = sheetsService;
        _spreadsheetId = spreadsheetId;
    }

    public async Task<string> GetWeeklyReportAsync()
    {
        DateTime today = DateTime.Today;
        int delta = DayOfWeek.Monday - today.DayOfWeek;
        DateTime weekStart = today.AddDays(delta);
        DateTime weekEnd = weekStart.AddDays(6);
        string monthSheetName = today.ToString("MMMM yyyy", new CultureInfo("ru-RU"));

        var response = await _sheetsService.Spreadsheets.Values.Get(_spreadsheetId, $"{monthSheetName}!A2:C").ExecuteAsync();
        var values = response.Values;
        if (values == null || values.Count == 0)
            return "Нет данных за эту неделю.";

        var reportDict = new Dictionary<string, decimal>();
        foreach (var row in values)
        {
            if (row.Count < 3) continue;
            string type = row[0]?.ToString() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(type)) continue;
            if (!decimal.TryParse(row[1]?.ToString(), out decimal amount)) continue;
            if (!DateTime.TryParse(row[2]?.ToString(), out DateTime date)) continue;
            if (date >= weekStart && date <= weekEnd)
            {
                if (!reportDict.ContainsKey(type)) reportDict[type] = 0;
                reportDict[type] += amount;
            }
        }
        if (reportDict.Count == 0)
            return "Нет расходов за эту неделю.";
        var report = "Отчет за неделю (" + weekStart.ToString("dd.MM") + " - " + weekEnd.ToString("dd.MM") + ")\n";
        foreach (var kv in reportDict)
            report += $"{kv.Key}: {kv.Value}kzt\n";
        return report;
    }

    public async Task<string> GetMonthlyReportAsync()
    {
        DateTime today = DateTime.Today;
        DateTime firstDayOfThisMonth = new DateTime(today.Year, today.Month, 1);
        DateTime lastMonth = firstDayOfThisMonth.AddMonths(-1);
        string monthSheetName = lastMonth.ToString("MMMM yyyy", new CultureInfo("ru-RU"));

        // Check if the sheet exists before querying
        var spreadsheet = await _sheetsService.Spreadsheets.Get(_spreadsheetId).ExecuteAsync();
        bool sheetExists = spreadsheet.Sheets.Any(s => s.Properties.Title == monthSheetName);
        if (!sheetExists)
            return "Нет данных за прошлый месяц.";

        var response = await _sheetsService.Spreadsheets.Values.Get(_spreadsheetId, $"{monthSheetName}!A2:C").ExecuteAsync();
        var values = response.Values;
        if (values == null || values.Count == 0)
            return "Нет данных за прошлый месяц.";

        var reportDict = new Dictionary<string, decimal>();
        foreach (var row in values)
        {
            if (row.Count < 3) continue;
            string type = row[0]?.ToString() ?? string.Empty;
            if (string.IsNullOrWhiteSpace(type)) continue;
            if (!decimal.TryParse(row[1]?.ToString(), out decimal amount)) continue;
            if (!DateTime.TryParse(row[2]?.ToString(), out DateTime date)) continue;
            if (date.Month == lastMonth.Month && date.Year == lastMonth.Year)
            {
                if (!reportDict.ContainsKey(type)) reportDict[type] = 0;
                reportDict[type] += amount;
            }
        }
        if (reportDict.Count == 0)
            return "Нет расходов за прошлый месяц.";
        var report = "Отчет за прошлый месяц (" + monthSheetName + ")\n";
        foreach (var kv in reportDict)
            report += $"{kv.Key}: {kv.Value}kzt\n";
        return report;
    }
}
