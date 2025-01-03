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
  <i align="center">Aplikasi ini di bangun menggunakan javaScript 🚀</i>
</p>
<p align="center">
  Hi, 🚀 Salam developer 🚀 I ❤️ Happy Hardcore ❤️
</p>

## Read About

Ini adalah bot trading futures binance
dengan mengkombinasikan strategi RSI,MACD,EMA DAN BOLINGER BANDS dengan anilisa AI dengan metode logical Fuzzy dan VWAP untuk menentukan kondisi pasar dan penempatan take profit dan stop loss. di bangun dengan javascript

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

Buat file .env , lalu tambahkan API key dan secret dari akun Binance Anda:

- .env
  ```sh
  API_KEY=your_binance_api_key
  API_SECRET=your_binance_api_secret
  ```

### Buat File config.json

File ini digunakan untuk menyimpan parameter grid trading. Contoh isi file config.json:

- config.json

  ```sh
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
node grid.js
```

### fitur bot :

- Menentukan kondisi Long atau short secara otomatis
- take profit dan stop loss di buat secara otomatis
- aplikasi memulai trading baru jika take profit dan stop loss telah tercapai
- pemantauan kondisi pasar extreme akan menutup semua order open dan open posisi secara otomatis

### Note\*

Risiko Trading: Trading futures melibatkan risiko besar. Pastikan Anda memahami risiko sebelum menggunakan bot ini.
Gunakan VPN luar negeri karna untuk binance di Indonesia sudah di blokir.
