@echo off
REM ============================================================
REM  Copies your local library_db into the Railway database.
REM  Run from Command Prompt (or: cmd /c migrate-db.bat)
REM ============================================================

REM --- Find PostgreSQL's bin folder automatically ---
set "PGBIN="
for /d %%D in ("C:\Program Files\PostgreSQL\*") do (
  if exist "%%D\bin\pg_dump.exe" set "PGBIN=%%D\bin"
)
if not defined PGBIN (
  for /d %%D in ("C:\Program Files (x86)\PostgreSQL\*") do (
    if exist "%%D\bin\pg_dump.exe" set "PGBIN=%%D\bin"
  )
)
if not defined PGBIN (
  echo ERROR: Could not find PostgreSQL on this computer.
  echo Looked in "C:\Program Files\PostgreSQL\..."
  echo If yours is installed elsewhere, tell Claude the folder path.
  pause
  exit /b 1
)
echo Using PostgreSQL tools from: %PGBIN%
echo.

echo Step 1 of 2: exporting your LOCAL database (library_db)...
echo When asked for a password, type your local postgres password.
echo.
"%PGBIN%\pg_dump.exe" -U postgres -d library_db --no-owner --no-acl > "%~dp0library_dump.sql"
if errorlevel 1 (
  echo.
  echo ERROR: export failed. Check the password and that PostgreSQL is running.
  pause
  exit /b 1
)
echo Export done: library_dump.sql created.
echo.

echo Step 2 of 2: uploading into Railway.
echo Paste your Railway DATABASE_PUBLIC_URL below and press Enter.
echo.
set /p RAILWAY_URL="DATABASE_URL: "
"%PGBIN%\psql.exe" "%RAILWAY_URL%" < "%~dp0library_dump.sql"
if errorlevel 1 (
  echo.
  echo ERROR: upload failed. Check the URL was pasted completely.
  pause
  exit /b 1
)
echo.
echo SUCCESS! Your data is now in the Railway database.
pause
