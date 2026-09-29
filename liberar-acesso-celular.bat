@echo off
echo.
echo Liberando acesso do celular ao sistema Ana Paula Fisioterapeuta...
echo.
netsh advfirewall firewall add rule name="Ana Paula Fisioterapeuta - Porta 3080" dir=in action=allow protocol=TCP localport=3080
echo.
echo Se apareceu "Ok.", tente acessar no celular:
echo http://192.168.0.12:3080
echo.
pause
