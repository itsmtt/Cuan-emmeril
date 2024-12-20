const Binance = require('binance-api-node').default;
const chalk = require('chalk'); // Untuk memberikan warna pada output

// Konfigurasi API key dan secret Anda
const client = Binance({
  apiKey: 'XmRkrzNO7gFvUjB16WfHTBUs04T2UpXdN37UDfWPriMVoSQ9hUqnuPVAOUMR5p7Q',
  apiSecret: 's1bzfjvCWXZQa2w8VL3VgkoXUcTd64ygXzjLsvnWYckxvsRF7ryX2YyQFOfqe63E',
});

// Parameter trading
const SYMBOL = 'XRPUSDT'; // Symbol yang akan ditradingkan
const ORDER_AMOUNT_USDT = 1; // Jumlah USDT yang akan digunakan untuk order
const LEVERAGE = 10; // Leverage untuk trading futures
const SHORT_EMA_PERIOD = 9; // Periode EMA pendek
const LONG_EMA_PERIOD = 21; // Periode EMA panjang
const ATR_PERIOD = 14; // Periode ATR untuk menghitung volatilitas

let totalProfit = 0;
let totalLoss = 0;
let reconnectAttempts = 0;
let activeOrder = null; // Menyimpan informasi order yang sedang aktif

async function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = data[0]; // EMA pertama diinisialisasi ke harga pertama
  
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

async function calculateATR(candles, period) {
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const high = parseFloat(candles[i].high);
    const low = parseFloat(candles[i].low);
    const closePrev = parseFloat(candles[i - 1].close);

    const tr = Math.max(
      high - low,
      Math.abs(high - closePrev),
      Math.abs(low - closePrev)
    );
    trueRanges.push(tr);
  }

  const atr = await calculateEMA(trueRanges.slice(-period), period);
  return atr;
}

async function closeOpenOrders() {
  try {
    const positions = await client.futuresPositionRisk();
    const openPosition = positions.find(position => parseFloat(position.positionAmt) !== 0 && position.symbol === SYMBOL);

    if (openPosition) {
      console.log(chalk.yellow(`Order terbuka terdeteksi pada ${SYMBOL}. Menutup order...`));

      const side = parseFloat(openPosition.positionAmt) > 0 ? 'SELL' : 'BUY';
      const quantity = Math.abs(parseFloat(openPosition.positionAmt));

      await client.futuresOrder({
        symbol: SYMBOL,
        side: side,
        type: 'MARKET',
        quantity: quantity.toFixed(6),
      });

      console.log(chalk.green(`Order terbuka berhasil ditutup.`));
    } else {
      console.log(chalk.green('Tidak ada order terbuka yang perlu ditutup.')); 
    }
  } catch (error) {
    console.error(chalk.bgRed('Gagal memeriksa atau menutup order terbuka:'), error);
  }
}

async function trade() {
  try {
    // Cek dan tutup order terbuka saat bot mulai
    await closeOpenOrders();

    // Jeda waktu untuk memastikan sistem stabil sebelum membuat order baru
    console.log(chalk.blue('Menunggu 5 detik sebelum memulai order baru...'));
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Ambil informasi simbol untuk mendapatkan step size
    const exchangeInfo = await client.futuresExchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === SYMBOL);
    const stepSize = parseFloat(symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE').stepSize);

    // Set leverage
    await client.futuresLeverage({
      symbol: SYMBOL,
      leverage: LEVERAGE,
    });

    while (true) {
      try {
        // Ambil data candlestick
        const candles = await client.futuresCandles({
          symbol: SYMBOL,
          interval: '1m',
          limit: ATR_PERIOD + 1,
        });

        // Hitung ATR
        const atr = await calculateATR(candles, ATR_PERIOD);

        // Hitung EMA pendek dan panjang
        const closingPrices = candles.map(c => parseFloat(c.close));
        const shortEMA = await calculateEMA(closingPrices.slice(-SHORT_EMA_PERIOD - 1), SHORT_EMA_PERIOD);
        const longEMA = await calculateEMA(closingPrices.slice(-LONG_EMA_PERIOD - 1), LONG_EMA_PERIOD);

        console.log(`Short EMA: ${shortEMA}, Long EMA: ${longEMA}, ATR: ${atr.toFixed(4)}`);

        // Tentukan sinyal entry
        if (shortEMA > longEMA) {
          console.log(chalk.green('Sinyal BUY terdeteksi'));

          const ticker = await client.futuresPrices();
          const lastPrice = parseFloat(ticker[SYMBOL]);
          let quantity = (ORDER_AMOUNT_USDT * LEVERAGE) / lastPrice;
          quantity = Math.floor(quantity / stepSize) * stepSize;

          const takeProfit = lastPrice + 2 * atr; // Take profit 2x ATR
          const stopLoss = lastPrice - atr; // Stop loss 1x ATR

          // Buat order market buy
          const buyOrder = await client.futuresOrder({
            symbol: SYMBOL,
            side: 'BUY',
            type: 'MARKET',
            quantity: quantity.toFixed(6),
          });

          console.log(chalk.green('Order beli berhasil:'), buyOrder);

          activeOrder = { side: 'BUY', price: lastPrice, quantity, takeProfit, stopLoss };

          // Tunggu sampai take profit atau stop loss
          await monitorOrder(quantity, 'BUY', takeProfit, stopLoss);
        } else if (shortEMA < longEMA) {
          console.log(chalk.red('Sinyal SELL terdeteksi'));

          const ticker = await client.futuresPrices();
          const lastPrice = parseFloat(ticker[SYMBOL]);
          let quantity = (ORDER_AMOUNT_USDT * LEVERAGE) / lastPrice;
          quantity = Math.floor(quantity / stepSize) * stepSize;

          const takeProfit = lastPrice - 2 * atr; // Take profit 2x ATR
          const stopLoss = lastPrice + atr; // Stop loss 1x ATR

          // Buat order market sell
          const sellOrder = await client.futuresOrder({
            symbol: SYMBOL,
            side: 'SELL',
            type: 'MARKET',
            quantity: quantity.toFixed(6),
          });

          console.log(chalk.red('Order jual berhasil:'), sellOrder);

          activeOrder = { side: 'SELL', price: lastPrice, quantity, takeProfit, stopLoss };

          // Tunggu sampai take profit atau stop loss
          await monitorOrder(quantity, 'SELL', takeProfit, stopLoss);
        } else {
          console.log('Tidak ada sinyal trading saat ini.');
        }

        reconnectAttempts = 0;
      } catch (error) {
        console.error(chalk.bgRed('Kesalahan saat trading:'), error);
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } catch (error) {
    console.error(chalk.bgRed('Terjadi kesalahan utama:'), error);
  }
}

async function monitorOrder(quantity, side, takeProfit, stopLoss) {
  while (true) {
    try {
      const ticker = await client.futuresPrices();
      const currentPrice = parseFloat(ticker[SYMBOL]);

      if ((side === 'BUY' && currentPrice >= takeProfit) || (side === 'SELL' && currentPrice <= takeProfit)) {
        console.log(chalk.bgGreen(`Take profit tercapai pada harga ${takeProfit.toFixed(4)}.`));

        await client.futuresOrder({
          symbol: SYMBOL,
          side: side === 'BUY' ? 'SELL' : 'BUY',
          type: 'MARKET',
          quantity: quantity.toFixed(6),
        });

        activeOrder = null;
        break;
      } else if ((side === 'BUY' && currentPrice <= stopLoss) || (side === 'SELL' && currentPrice >= stopLoss)) {
        console.log(chalk.bgRed(`Stop loss tercapai pada harga ${stopLoss.toFixed(4)}.`));

        await client.futuresOrder({
          symbol: SYMBOL,
          side: side === 'BUY' ? 'SELL' : 'BUY',
          type: 'MARKET',
          quantity: quantity.toFixed(6),
        });

        activeOrder = null;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(chalk.bgRed('Kesalahan saat memonitor order:'), error);
    }
  }
}

trade();
