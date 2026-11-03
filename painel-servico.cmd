@echo off
rem Mantem o painel sempre ativo: se cair, volta em 5 segundos.
cd /d "%~dp0"
:loop
node src\painel.js --sem-abrir >nul 2>&1
set COD=%errorlevel%
if "%COD%"=="3" goto fim
echo [%date% %time%] painel caiu (codigo %COD%), reiniciando >> painel\servico.log
timeout /t 5 /nobreak >nul
goto loop
:fim
