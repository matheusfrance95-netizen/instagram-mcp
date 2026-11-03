@echo off
rem Instalador do instagram-mcp: instala as dependencias e prepara este computador.
cd /d "%~dp0"
where node >/dev/null 2>/dev/null || (echo Instale o Node.js LTS em https://nodejs.org e rode de novo. & pause & exit /b 1)
call npm install
node src\instalar.js
pause
