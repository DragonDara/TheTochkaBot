# Use the official .NET 8.0 SDK image for build (Linux)
FROM --platform=linux/amd64 mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /app

# Copy csproj and restore as distinct layers
COPY *.sln ./
COPY TheTochkaBot/*.csproj ./TheTochkaBot/
RUN dotnet restore

# Copy everything else and build
COPY TheTochkaBot/. ./TheTochkaBot/
WORKDIR /app/TheTochkaBot
RUN dotnet publish -c Release -o out

# Use the official .NET 8.0 runtime image for final stage (Linux)
FROM --platform=linux/amd64 mcr.microsoft.com/dotnet/aspnet:8.0 AS base
WORKDIR /app
COPY --from=build /app/TheTochkaBot/out .

# Set environment variables (optional, can be overridden)
# ENV GOOGLE_SERVICE_ACCOUNT_JSON=... 
# ENV TELEGRAM_BOT_TOKEN=... 
# ENV GOOGLE_SHEET_ID=... 

ENTRYPOINT ["dotnet", "TheTochkaBot.dll"]
