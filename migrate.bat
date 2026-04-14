@echo off
REM Migration Script - Apply Database Changes (Windows)
REM Run this after pulling the latest code changes

echo Starting migration process...

REM Check if .env exists
if not exist .env (
    echo Error: .env file not found!
    echo Please copy .env.example to .env and configure it first:
    echo    copy .env.example .env
    exit /b 1
)

REM Check if JWT_SECRET is configured
findstr /C:"CHANGE_ME_TO_STRONG_SECRET_KEY_IN_PRODUCTION" .env >nul
if %errorlevel% equ 0 (
    echo WARNING: JWT_SECRET is not configured!
    echo Generate a strong key and update it in your .env file
    set /p continue="Continue anyway? (y/N): "
    if /i not "%continue%"=="y" exit /b 1
)

echo Installing dependencies...
call npm install

echo Generating Prisma client...
call npx prisma generate

echo Running database migrations...
call npx prisma migrate deploy

echo.
echo Migration completed successfully!
echo.
echo Next steps:
echo    1. Review the README.md for project documentation
echo    2. Ensure JWT_SECRET is configured in .env
echo    3. Configure ALLOWED_ORIGINS for CORS
echo    4. Start the server with: npm start

pause
