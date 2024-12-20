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
const SHORT_EMA_PERIOD = 5; // Periode EMA pendek untuk scalping
const LONG_EMA_PERIOD = 20; // Periode EMA panjang untuk scalping
const RSI_PERIOD = 14; // Periode RSI untuk scalping
const PROFIT_TARGET_PERCENT = 0.02; // Target profit 2%
const STOP_LOSS_PERCENT = 0.01; // Stop-loss 1%
const TIME_FRAME = '5m'; // Kerangka waktu 5 menit untuk scalping

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
          interval: TIME_FRAME, // Menggunakan kerangka waktu 5 menit
          limit: Math.max(SHORT_EMA_PERIOD, LONG_EMA_PERIOD, RSI_PERIOD) + 1,
        });

        // Hitung indikator
        const closingPrices = candles.map(c => parseFloat(c.close));
        const shortEMA = await calculateEMA(closingPrices.slice(-SHORT_EMA_PERIOD - 1), SHORT_EMA_PERIOD);
        const longEMA = await calculateEMA(closingPrices.slice(-LONG_EMA_PERIOD - 1), LONG_EMA_PERIOD);
        const rsi = await calculateRSI(candles.slice(-RSI_PERIOD - 1), RSI_PERIOD);

        console.log(`Short EMA: ${shortEMA.toFixed(4)}, Long EMA: ${longEMA.toFixed(4)}, RSI: ${rsi.toFixed(2)}`);

        // Kondisi Entry Buy
        if (shortEMA > longEMA && rsi < 70) {
          console.log(chalk.green('Sinyal BUY terdeteksi'));

          const ticker = await client.futuresPrices();
          const lastPrice = parseFloat(ticker[SYMBOL]);
          let quantity = (ORDER_AMOUNT_USDT * LEVERAGE) / lastPrice;
          quantity = Math.floor(quantity / stepSize) * stepSize;

          const takeProfit = lastPrice * (1 + PROFIT_TARGET_PERCENT); // Take profit 2%
          const stopLoss = lastPrice * (1 - STOP_LOSS_PERCENT); // Stop loss 1%

          const buyOrder = await client.futuresOrder({
            symbol: SYMBOL,
            side: 'BUY',
            type: 'MARKET',
            quantity: quantity.toFixed(6),
          });

          console.log(chalk.green('Order beli berhasil:'), buyOrder);

          activeOrder = { side: 'BUY', price: lastPrice, quantity, takeProfit, stopLoss };
          await monitorOrder(quantity, 'BUY', takeProfit, stopLoss);
        } 

        // Kondisi Entry Sell
        else if (shortEMA < longEMA && rsi > 30) {
          console.log(chalk.red('Sinyal SELL terdeteksi'));

          const ticker = await client.futuresPrices();
          const lastPrice = parseFloat(ticker[SYMBOL]);
          let quantity = (ORDER_AMOUNT_USDT * LEVERAGE) / lastPrice;
          quantity = Math.floor(quantity / stepSize) * stepSize;

          const takeProfit = lastPrice * (1 - PROFIT_TARGET_PERCENT); // Take profit 2%
          const stopLoss = lastPrice * (1 + STOP_LOSS_PERCENT); // Stop loss 1%

          const sellOrder = await client.futuresOrder({
            symbol: SYMBOL,
            side: 'SELL',
            type: 'MARKET',
            quantity: quantity.toFixed(6),
          });

          console.log(chalk.red('Order jual berhasil:'), sellOrder);

          activeOrder = { side: 'SELL', price: lastPrice, quantity, takeProfit, stopLoss };
          await monitorOrder(quantity, 'SELL', takeProfit, stopLoss);
        } else {
          console.log('Tidak ada sinyal trading saat ini.');
        }
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
