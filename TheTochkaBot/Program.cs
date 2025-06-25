using Google.Apis.Auth.OAuth2;
using Google.Apis.Sheets.v4;

Console.WriteLine("Starting Telegram Expense Bot...");

GoogleCredential credential = GoogleCredential
    .FromFile("service-account.json")
    .CreateScoped(new[] { SheetsService.Scope.Spreadsheets });

var bot = new TelegramExpenseBot("7825623899:AAFUMnPSRc7gaoVwC_WnOBKTEkRrd_ivd44", "1qFVzB8USG0L9YtV-6ymnYTLothxBOU_1KYl0iunNO5Y", credential);
bot.Start();
Console.WriteLine("Telegram Expense Bot is run");

Console.ReadLine();