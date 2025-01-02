Ini adalah bot trading futures binance 
dengan mengkombinasikan strategi RSI,MACD,EMA DAN BOLINGER BANDS dengan anilisa AI dengan metode logical Fuzzy dan VWAP 
untuk menentukan kondisi pasar dan penempatan take profit dan stop loss. di bangun dengan javascript  

untuk menggunakanya bot nya lakukan setup dengan cara :

1. Instalasi Dependensi

Jalankan perintah berikut di terminal pada direktori proyek Anda:

npm init -y

npm install binance-api-node dotenv chalk fs

2. Konfigurasi File .env

Buat file .env di direktori proyek Anda, lalu tambahkan API key dan secret dari akun Binance Anda:

API_KEY=your_binance_api_key

API_SECRET=your_binance_api_secret

3. Buat File config.json

File ini digunakan untuk menyimpan parameter grid trading. Contoh isi file config.json:

{

  "SYMBOL": "BTCUSDT",
  
  "GRID_COUNT": 5,
  
  "LEVERAGE": 10,
  
  "BASE_USDT": 10
  
}

4. Jalankan Bot

Pastikan semua konfigurasi sudah benar, lalu jalankan bot dengan perintah:

node grid.js

