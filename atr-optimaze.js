const Binance = require('binance-api-node').default;
const chalk = require('chalk'); // Untuk memberikan warna pada output

// Konfigurasi API key dan secret Anda
const client = Binance({
  apiKey: 'XmRkrzNO7gFvUjB16WfHTBUs04T2UpXdN37UDfWPriMVoSQ9hUqnuPVAOUMR5p7Q',
  apiSecret: 's1bzfjvCWXZQa2w8VL3VgkoXUcTd64ygXzjLsvnWYckxvsRF7ryX2YyQFOfqe63E',
});

// Parameter trading
const SYMBOL = 'XRPUSDT'; // Symbol yang akan ditradingkan
const ORDER_AMOUNT_USDT = 1; // Jumlah USDT yang digunakan per order
const LEVERAGE = 10; // Leverage untuk trading futures
const SHORT_EMA_PERIOD = 9; // Periode EMA pendek
const LONG_EMA_PERIOD = 21; // Periode EMA panjang
const ATR_PERIOD = 14; // Periode ATR
const MIN_ATR = 0.001; // Filter volatilitas minimum
const RISK_REWARD_RATIO = 1.5; // Rasio risk/reward dinamis

let totalProfit = 0;
let totalLoss = 0;
let activeOrder = null; // Menyimpan informasi order aktif

async function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = data[0];
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
    const tr = Math.max(high - low, Math.abs(high - closePrev), Math.abs(low - closePrev));
    trueRanges.push(tr);
  }
  return calculateEMA(trueRanges.slice(-period), period);
}

async function closeOpenOrders() {
  try {
    const positions = await client.futuresPositionRisk();
    const openPosition = positions.find(position => parseFloat(position.positionAmt) !== 0 && position.symbol === SYMBOL);

    if (openPosition) {
      console.log(chalk.yellow(`Menutup order terbuka pada ${SYMBOL}...`));
      const side = parseFloat(openPosition.positionAmt) > 0 ? 'SELL' : 'BUY';
      const quantity = Math.abs(parseFloat(openPosition.positionAmt));

      await client.futuresOrder({
        symbol: SYMBOL,
        side: side,
        type: 'MARKET',
        quantity: quantity.toFixed(6),
      });

      console.log(chalk.green('Order terbuka berhasil ditutup.'));
    } else {
      console.log(chalk.green('Tidak ada order terbuka.'));
    }
  } catch (error) {
    console.error(chalk.bgRed('Kesalahan saat menutup order:'), error);
  }
}

async function trade() {
  await closeOpenOrders();
  await new Promise(resolve => setTimeout(resolve, 5000)); // Jeda 5 detik sebelum order baru

  const exchangeInfo = await client.futuresExchangeInfo();
  const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === SYMBOL);
  const stepSize = parseFloat(symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE').stepSize);

  await client.futuresLeverage({ symbol: SYMBOL, leverage: LEVERAGE });

  while (true) {
    try {
      const candles = await client.futuresCandles({
        symbol: SYMBOL,
        interval: '1m',
        limit: ATR_PERIOD + 1,
      });

      const atr = await calculateATR(candles, ATR_PERIOD);
      if (atr < MIN_ATR) {
        console.log(chalk.yellow('Volatilitas terlalu rendah, melewatkan trading.'));
        continue;
      }

      const closingPrices = candles.map(c => parseFloat(c.close));
      const shortEMA = await calculateEMA(closingPrices.slice(-SHORT_EMA_PERIOD - 1), SHORT_EMA_PERIOD);
      const longEMA = await calculateEMA(closingPrices.slice(-LONG_EMA_PERIOD - 1), LONG_EMA_PERIOD);

      console.log(`Short EMA: ${shortEMA}, Long EMA: ${longEMA}, ATR: ${atr.toFixed(4)}`);

      const ticker = await client.futuresPrices();
      const lastPrice = parseFloat(ticker[SYMBOL]);
      let quantity = (ORDER_AMOUNT_USDT * LEVERAGE) / lastPrice;
      quantity = Math.floor(quantity / stepSize) * stepSize;

      let takeProfit, stopLoss;
      if (shortEMA > longEMA) {
        console.log(chalk.green('Sinyal BUY terdeteksi'));
        takeProfit = lastPrice + RISK_REWARD_RATIO * atr;
        stopLoss = lastPrice - atr;

        const buyOrder = await client.futuresOrder({
          symbol: SYMBOL,
          side: 'BUY',
          type: 'MARKET',
          quantity: quantity.toFixed(6),
        });

        console.log(chalk.green('Order beli berhasil:'), buyOrder);
        activeOrder = { side: 'BUY', price: lastPrice, quantity, takeProfit, stopLoss };

      } else if (shortEMA < longEMA) {
        console.log(chalk.red('Sinyal SELL terdeteksi'));
        takeProfit = lastPrice - RISK_REWARD_RATIO * atr;
        stopLoss = lastPrice + atr;

        const sellOrder = await client.futuresOrder({
          symbol: SYMBOL,
          side: 'SELL',
          type: 'MARKET',
          quantity: quantity.toFixed(6),
        });

        console.log(chalk.red('Order jual berhasil:'), sellOrder);
        activeOrder = { side: 'SELL', price: lastPrice, quantity, takeProfit, stopLoss };
      } else {
        console.log('Tidak ada sinyal trading saat ini.');
        continue;
      }

      await monitorOrder(quantity, activeOrder.side, takeProfit, stopLoss);
    } catch (error) {
      console.error(chalk.bgRed('Kesalahan trading:'), error);
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}

async function monitorOrder(quantity, side, takeProfit, stopLoss) {
  while (true) {
    try {
      const ticker = await client.futuresPrices();
      const currentPrice = parseFloat(ticker[SYMBOL]);

      if ((side === 'BUY' && currentPrice >= takeProfit) || (side === 'SELL' && currentPrice <= takeProfit)) {
        console.log(chalk.bgGreen(`Take profit tercapai pada harga ${takeProfit.toFixed(4)}`));
        await client.futuresOrder({
          symbol: SYMBOL,
          side: side === 'BUY' ? 'SELL' : 'BUY',
          type: 'MARKET',
          quantity: quantity.toFixed(6),
        });
        break;

      } else if ((side === 'BUY' && currentPrice <= stopLoss) || (side === 'SELL' && currentPrice >= stopLoss)) {
        console.log(chalk.bgRed(`Stop loss tercapai pada harga ${stopLoss.toFixed(4)}`));
        await client.futuresOrder({
          symbol: SYMBOL,
          side: side === 'BUY' ? 'SELL' : 'BUY',
          type: 'MARKET',
          quantity: quantity.toFixed(6),
        });
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(chalk.bgRed('Kesalahan memonitor order:'), error);
    }
  }
}

trade();
