using Google.Apis.Auth.OAuth2;
using Google.Apis.Sheets.v4;
using System;
using System.IO;
using System.Threading;

Console.WriteLine("Starting Telegram Expense Bot...");

var json = Environment.GetEnvironmentVariable("GOOGLE_SERVICE_ACCOUNT_JSON");
if (string.IsNullOrWhiteSpace(json))
{
    // Fallback to local file if env var is not set
    json = File.ReadAllText("service-account.json");
}
GoogleCredential credential = GoogleCredential
    .FromJson(json)
    .CreateScoped(new[] { SheetsService.Scope.Spreadsheets });

var bot = new TelegramExpenseBot("7825623899:AAFUMnPSRc7gaoVwC_WnOBKTEkRrd_ivd44", "1qFVzB8USG0L9YtV-6ymnYTLothxBOU_1KYl0iunNO5Y", credential);
bot.Start();
Console.WriteLine("Telegram Expense Bot is run");

Thread.Sleep(Timeout.Infinite);