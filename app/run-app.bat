@echo off
REM YT Longform Studio - aplikasi kontrol lokal
cd /d "%~dp0"
echo Memastikan dependensi terpasang...
python -m pip install -r requirements.txt --quiet --disable-pip-version-check
echo Menjalankan aplikasi...
python yt_studio.py
pause
