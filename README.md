<!-- EN -->

<div align="center">
<a href="z"><img src="https://img.shields.io/badge/ChatGPT-74aa9c?style=for-the-badge&logo=openai&logoColor=white"/></a>
<a href="z"><img src="https://img.shields.io/badge/Bitcoin-000000?style=for-the-badge&logo=bitcoin&logoColor=white"/></a>
<a href="z"><img src="https://img.shields.io/badge/Ethereum-3C3C3D?style=for-the-badge&logo=Ethereum&logoColor=white"/></a>
<a href="z"><img src="https://img.shields.io/badge/Litecoin-A6A9AA?style=for-the-badge&logo=Litecoin&logoColor=white"/></a>
<a href="z"><img src="https://img.shields.io/badge/.NET-512BD4?style=for-the-badge&logo=dotnet&logoColor=white"/></a>
<a href="z"><img src="https://img.shields.io/badge/Visual_Studio-5C2D91?style=for-the-badge&logo=visual%20studio&logoColor=white"/></a>
<a href="z"><img src="https://img.shields.io/badge/VSCode-0078D4?style=for-the-badge&logo=visual%20studio%20code&logoColor=white"/></a>
</div>

---

<p align="center">
  <i align="center">Aplikasi ini dibangun menggunakan JavaScript 🚀</i>
</p>
<p align="center">
  Hi, 🚀 Salam developer 🚀 I ❤️ Happy Hardcore ❤️
</p>

## Read About

Ini adalah bot trading futures Binance yang mengkombinasikan strategi RSI, MACD, EMA, dan Bollinger Bands dengan analisa AI menggunakan metode logika Fuzzy dan VWAP. Bot ini digunakan untuk menentukan kondisi pasar dan penempatan take profit serta stop loss secara otomatis. Dibangun dengan JavaScript, bot ini dirancang untuk membantu trader dalam mengelola order dan posisi, melakukan analisis teknikal, menerapkan strategi grid trading, serta memantau dan mencatat performa trading.

<!-- GETTING STARTED -->

## Getting Started

### Instalasi Dependensi

Jalankan perintah berikut di terminal:

- npm
  ```sh
  npm init -y
  npm install binance-api-node dotenv chalk fs
  ```

### Konfigurasi File .env

Buat file .env, lalu tambahkan API key dan secret dari akun Binance Anda:

- .env
  ```sh
  API_KEY=your_binance_api_key
  API_SECRET=your_binance_api_secret
  ```

### Buat File config.json

File ini digunakan untuk menyimpan parameter grid trading. Contoh isi file config.json:

- config.json
  ```json
  {
    "SYMBOL": "BTCUSDT",
    "GRID_COUNT": 5,
    "LEVERAGE": 10,
    "BASE_USDT": 10
  }
  ```

### Jalankan Bot

Pastikan semua konfigurasi sudah benar, lalu jalankan bot dengan perintah:

```sh
node index.js
```

### Fitur Bot

1. **Manajemen Order dan Posisi**
   - Menutup semua order terbuka sebelum memulai trading untuk mencegah konflik strategi.
   - Menutup semua posisi terbuka untuk memastikan bot memulai dari kondisi bersih.
   - Memeriksa dan membatalkan order terbuka jika kondisi pasar berubah drastis.
2. **Analisis Teknikal untuk Trading**
   - ATR (Average True Range) untuk mengukur volatilitas pasar.
   - VWAP (Volume Weighted Average Price) untuk menentukan level harga yang wajar.
   - RSI (Relative Strength Index) untuk mengidentifikasi kondisi overbought dan oversold.
   - MACD (Moving Average Convergence Divergence) untuk melihat tren pasar.
   - Bollinger Bands untuk mengukur volatilitas dan kemungkinan breakout.
   - Logika Fuzzy untuk menentukan kondisi pasar ekstrem.
3. **Strategi Grid Trading**
   - Menempatkan order grid berdasarkan volatilitas dan kondisi pasar.
   - Menyesuaikan grid spacing sesuai dengan volatilitas historis.
   - Menyesuaikan jumlah grid order berdasarkan volatilitas pasar.
4. **Manajemen Risiko**
   - Menetapkan Take Profit (TP) dan Stop Loss (SL) secara dinamis berdasarkan ATR.
   - Memeriksa kondisi pasar ekstrem, seperti volatilitas tinggi atau harga jauh dari VWAP, untuk menghentikan trading sementara.
   - Menggunakan leverage yang dapat disesuaikan berdasarkan konfigurasi pengguna.
5. **Monitoring dan Logging**
   - Memantau status order terbuka dan menutup posisi jika tidak ada Take Profit atau Stop Loss.
   - Melakukan evaluasi profit dan loss setiap iterasi untuk mencatat performa trading.
   - Loop trading terus-menerus dengan jeda waktu tertentu.

### Simulasi Aplikasi Berjalan

<div align="center">
<a href="z"><img src="https://github.com/itsmtt/Cuan-emmeril/blob/main/img/code_runing.png"/></a>
</div>

### Note

**Risiko Trading:** Trading futures melibatkan risiko besar. Pastikan Anda memahami risiko sebelum menggunakan bot ini.
Gunakan VPN luar negeri karena Binance di Indonesia sudah diblokir.
