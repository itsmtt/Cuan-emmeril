require('dotenv').config(); // Load .env file
const Binance = require('binance-api-node').default;
const chalk = require('chalk');

// Validasi API Key
if (!process.env.API_KEY || !process.env.API_SECRET) {
  console.error(chalk.bgRed('API Key atau Secret tidak ditemukan. Pastikan file .env sudah diatur dengan benar.'));
  process.exit(1);
}

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
});

// Parameter trading untuk grid
const SYMBOL = 'XRPUSDT'; // Symbol yang akan ditradingkan
const GRID_COUNT = 5; // Jumlah level grid di atas dan di bawah harga pasar saat ini
const LEVERAGE = 50; // Leverage untuk trading
const BASE_USDT = 0.2; // Nilai order per grid dalam USDT

let totalProfit = 0;
let totalLoss = 0;

// Fungsi untuk menghitung EMA
async function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

// Fungsi untuk menghitung RSI
async function calculateRSI(candles, period) {
  const closingPrices = candles.map(c => parseFloat(c.close));
  let gains = 0, losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closingPrices[i] - closingPrices[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgGain / avgLoss;

  return 100 - (100 / (1 + rs));
}

// Fungsi untuk menghitung ATR
async function calculateATR(candles, period) {
  const highs = candles.map(c => parseFloat(c.high));
  const lows = candles.map(c => parseFloat(c.low));
  const closes = candles.map(c => parseFloat(c.close));
  const trs = [];

  for (let i = 1; i < candles.length; i++) {
    const highLow = highs[i] - lows[i];
    const highClose = Math.abs(highs[i] - closes[i - 1]);
    const lowClose = Math.abs(lows[i] - closes[i - 1]);
    trs.push(Math.max(highLow, highClose, lowClose));
  }

  const atr = trs.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
  return atr;
}

// Fungsi untuk menutup semua order terbuka
async function closeOpenOrders() {
  try {
    console.log(chalk.blue('Memeriksa dan menutup semua order terbuka...'));
    const openOrders = await client.futuresOpenOrders({ symbol: SYMBOL });
    if (openOrders.length > 0) {
      for (const order of openOrders) {
        await client.futuresCancelOrder({ symbol: SYMBOL, orderId: order.orderId });
        console.log(chalk.green(`Order dengan ID ${order.orderId} berhasil dibatalkan.`));
      }
    } else {
      console.log(chalk.green('Tidak ada order terbuka yang perlu ditutup.'));
    }
  } catch (error) {
    console.error(chalk.bgRed('Kesalahan saat menutup order terbuka:'), error.message || error);
  }
}

// Fungsi untuk menentukan kondisi pasar
async function determineMarketCondition(candles) {
  const closingPrices = candles.map(c => parseFloat(c.close));
  const shortEMA = await calculateEMA(closingPrices.slice(-10), 10); // EMA pendek
  const longEMA = await calculateEMA(closingPrices.slice(-20), 20); // EMA panjang
  const rsi = await calculateRSI(candles, 14); // RSI

  console.log(chalk.yellow(`Short EMA: ${shortEMA.toFixed(6)}, Long EMA: ${longEMA.toFixed(6)}, RSI: ${rsi.toFixed(2)}`));

  if (shortEMA > longEMA && rsi < 70) {
    return 'LONG';
  } else if (shortEMA < longEMA && rsi > 30) {
    return 'SHORT';
  } else {
    return 'NEUTRAL';
  }
}

// Fungsi untuk menempatkan order grid
async function placeGridOrders(currentPrice, atr, direction) {
  try {
    console.log(chalk.blue(`Menempatkan order grid (${direction})...`));

    for (let i = 1; i <= GRID_COUNT; i++) {
      const price = direction === 'LONG'
        ? currentPrice - atr * i
        : currentPrice + atr * i;

      const quantity = (BASE_USDT * LEVERAGE) / currentPrice;

      await client.futuresOrder({
        symbol: SYMBOL,
        side: direction === 'LONG' ? 'BUY' : 'SELL',
        type: 'LIMIT',
        price: price.toFixed(6),
        quantity: quantity.toFixed(6),
        timeInForce: 'GTC',
      });

      console.log(chalk.green(`Order ${direction === 'LONG' ? 'beli' : 'jual'} ditempatkan di harga ${price.toFixed(6)} dengan kuantitas ${quantity.toFixed(6)}`));
    }

    console.log(chalk.blue('Semua order grid berhasil ditempatkan.'));
  } catch (error) {
    console.error(chalk.bgRed('Kesalahan saat menempatkan order grid:'), error.message || error);
  }
}

// Fungsi utama trading
async function trade() {
  try {
    const ticker = await client.futuresPrices();
    if (!ticker[SYMBOL]) throw new Error(`Symbol ${SYMBOL} tidak ditemukan.`);
    
    const currentPrice = parseFloat(ticker[SYMBOL]);
    console.log(chalk.yellow(`Harga pasar terkini untuk ${SYMBOL}: ${currentPrice.toFixed(6)}`));

    await client.futuresLeverage({ symbol: SYMBOL, leverage: LEVERAGE });

    const candles = await client.futuresCandles({
      symbol: SYMBOL,
      interval: '15m',
      limit: 20,
    });

    if (candles.length < 20) {
      console.warn(chalk.bgYellow('Data candle tidak mencukupi untuk analisis.'));
      return;
    }

    const atr = await calculateATR(candles, 14);
    console.log(chalk.yellow(`ATR saat ini: ${atr.toFixed(6)}`));

    const marketCondition = await determineMarketCondition(candles);

    if (marketCondition === 'LONG' || marketCondition === 'SHORT') {
      await placeGridOrders(currentPrice, atr, marketCondition);
    } else {
      console.log(chalk.blue('Kondisi pasar netral, tidak ada order grid yang ditempatkan.'));
    }
  } catch (error) {
    console.error(chalk.bgRed('Kesalahan utama dalam trading:'), error.message || error);
  }
}

// Loop utama untuk menjalankan bot
async function runBot() {
  await closeOpenOrders(); // Tutup order terbuka sebelum memulai trading
  while (true) {
    await trade();
    console.log(chalk.magenta(`Total Profit: ${totalProfit.toFixed(2)} USDT, Total Loss: ${totalLoss.toFixed(2)} USDT`));
  }
}

// Memulai bot
runBot();
