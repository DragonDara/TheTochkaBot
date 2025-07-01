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
        DateTime weekStart = today.AddDays(-6); // 7 days including today
        DateTime weekEnd = today;

        // Collect all relevant sheet names for the week range
        var sheetNames = new HashSet<string>();
        for (var date = weekStart; date <= weekEnd; date = date.AddDays(1))
        {
            sheetNames.Add(date.ToString("MMMM yyyy", new CultureInfo("ru-RU")));
        }

        var reportDict = new Dictionary<string, decimal>();
        bool hasData = false;
        foreach (var sheetName in sheetNames)
        {
            var spreadsheet = await _sheetsService.Spreadsheets.Get(_spreadsheetId).ExecuteAsync();
            if (!spreadsheet.Sheets.Any(s => s.Properties.Title == sheetName)) continue;
            var response = await _sheetsService.Spreadsheets.Values.Get(_spreadsheetId, $"{sheetName}!A2:C").ExecuteAsync();
            var values = response.Values;
            if (values == null || values.Count == 0) continue;
            hasData = true;
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
        }
        if (!hasData)
            return "Нет данных за последние 7 дней.";
        if (reportDict.Count == 0)
            return "Нет расходов за последние 7 дней.";
        var report = "Отчет за 7 дней (" + weekStart.ToString("dd.MM") + " - " + weekEnd.ToString("dd.MM") + ")\n";
        decimal total = 0;
        foreach (var kv in reportDict)
        {
            report += $"{kv.Key}: {kv.Value}kzt\n";
            total += kv.Value;
        }
        report += $"Всего: {total}kzt\n";
        return report;
    }

    public async Task<string> GetMonthlyReportAsync()
    {
        DateTime today = DateTime.Today;
        int daysInMonth = DateTime.DaysInMonth(today.Year, today.Month);
        DateTime monthStart = today.AddDays(-(daysInMonth - 1)); // last 30 or 31 days including today
        DateTime monthEnd = today;

        // Collect all relevant sheet names for the month range
        var sheetNames = new HashSet<string>();
        for (var date = monthStart; date <= monthEnd; date = date.AddDays(1))
        {
            sheetNames.Add(date.ToString("MMMM yyyy", new CultureInfo("ru-RU")));
        }

        var reportDict = new Dictionary<string, decimal>();
        bool hasData = false;
        foreach (var sheetName in sheetNames)
        {
            var spreadsheet = await _sheetsService.Spreadsheets.Get(_spreadsheetId).ExecuteAsync();
            if (!spreadsheet.Sheets.Any(s => s.Properties.Title == sheetName)) continue;
            var response = await _sheetsService.Spreadsheets.Values.Get(_spreadsheetId, $"{sheetName}!A2:C").ExecuteAsync();
            var values = response.Values;
            if (values == null || values.Count == 0) continue;
            hasData = true;
            foreach (var row in values)
            {
                if (row.Count < 3) continue;
                string type = row[0]?.ToString() ?? string.Empty;
                if (string.IsNullOrWhiteSpace(type)) continue;
                if (!decimal.TryParse(row[1]?.ToString(), out decimal amount)) continue;
                if (!DateTime.TryParse(row[2]?.ToString(), out DateTime date)) continue;
                if (date >= monthStart && date <= monthEnd)
                {
                    if (!reportDict.ContainsKey(type)) reportDict[type] = 0;
                    reportDict[type] += amount;
                }
            }
        }
        if (!hasData)
            return $"Нет данных за последние {daysInMonth} дней.";
        if (reportDict.Count == 0)
            return $"Нет расходов за последние {daysInMonth} дней.";
        var report = $"Отчет за {daysInMonth} дней (" + monthStart.ToString("dd.MM") + " - " + monthEnd.ToString("dd.MM") + ")\n";
        decimal total = 0;
        foreach (var kv in reportDict)
        {
            report += $"{kv.Key}: {kv.Value}kzt\n";
            total += kv.Value;
        }
        report += $"Всего: {total}kzt\n";
        return report;
    }
}
