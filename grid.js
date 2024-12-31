require("dotenv").config(); // Load .env file
const Binance = require("binance-api-node").default;
const chalk = require("chalk");

// Validasi API Key
if (!process.env.API_KEY || !process.env.API_SECRET) {
  console.error(
    chalk.bgRed(
      "API Key atau Secret tidak ditemukan. Pastikan file .env sudah diatur dengan benar."
    )
  );
  process.exit(1);
}

const client = Binance({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
});

// Parameter trading untuk grid
const SYMBOL = "XRPUSDT"; // Symbol yang akan ditradingkan
const GRID_COUNT = 2; // Jumlah level grid di atas dan di bawah harga pasar saat ini
const LEVERAGE = 10; // Leverage untuk trading
const BASE_USDT = 1; // Nilai order per grid dalam USDT

let totalProfit = 0;
let totalLoss = 0;

// Fungsi untuk mendapatkan presisi pasangan perdagangan
async function getSymbolPrecision(symbol) {
  try {
    const exchangeInfo = await client.futuresExchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === symbol);
    if (!symbolInfo) throw new Error(`Symbol ${symbol} tidak ditemukan.`);
    const pricePrecision = symbolInfo.pricePrecision; // Presisi untuk harga
    const quantityPrecision = symbolInfo.quantityPrecision; // Presisi untuk kuantitas
    return { pricePrecision, quantityPrecision };
  } catch (error) {
    console.error(
      chalk.bgRed("Kesalahan saat mendapatkan presisi pasangan perdagangan:"),
      error.message || error
    );
    throw error;
  }
}

// Fungsi untuk menutup semua order terbuka
async function closeOpenOrders() {
  try {
    console.log(chalk.blue("Memeriksa dan menutup semua order terbuka..."));
    const openOrders = await client.futuresOpenOrders({ symbol: SYMBOL });
    if (openOrders.length > 0) {
      for (const order of openOrders) {
        await client.futuresCancelOrder({
          symbol: SYMBOL,
          orderId: order.orderId,
        });
        console.log(
          chalk.green(`Order dengan ID ${order.orderId} berhasil dibatalkan.`)
        );
      }
    } else {
      console.log(chalk.green("Tidak ada order terbuka yang perlu ditutup."));
    }
  } catch (error) {
    console.error(
      chalk.bgRed("Kesalahan saat menutup order terbuka:"),
      error.message || error
    );
  }
}

// Fungsi untuk menutup semua posisi terbuka
async function closeOpenPositions() {
  try {
    console.log(chalk.blue("Memeriksa dan menutup semua posisi terbuka..."));
    const positions = await client.futuresPositionRisk();
    for (const position of positions) {
      if (parseFloat(position.positionAmt) !== 0) {
        const side = parseFloat(position.positionAmt) > 0 ? "SELL" : "BUY";
        const quantity = Math.abs(parseFloat(position.positionAmt));
        await client.futuresOrder({
          symbol: position.symbol,
          side,
          type: "MARKET",
          quantity,
        });
        console.log(
          chalk.green(
            `Posisi pada ${position.symbol} berhasil ditutup dengan kuantitas ${quantity}.`
          )
        );
      }
    }
  } catch (error) {
    console.error(
      chalk.bgRed("Kesalahan saat menutup posisi terbuka:"),
      error.message || error
    );
  }
}

// Fungsi untuk memeriksa apakah semua order telah selesai
async function waitForOrdersToComplete() {
  try {
    console.log(chalk.blue("Menunggu semua order selesai..."));
    let openOrders;
    do {
      openOrders = await client.futuresOpenOrders({ symbol: SYMBOL });
      if (openOrders.length > 0) {
        console.log(
          chalk.yellow(
            `Masih ada ${openOrders.length} order terbuka, menunggu...`
          )
        );
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Tunggu 5 detik sebelum memeriksa lagi
      }
    } while (openOrders.length > 0);
    console.log(chalk.green("Semua order telah selesai."));
  } catch (error) {
    console.error(
      chalk.bgRed("Kesalahan saat memeriksa status order:"),
      error.message || error
    );
  }
}

// Fungsi untuk menghitung ATR
async function calculateATR(candles, period) {
  const highs = candles.map((c) => parseFloat(c.high));
  const lows = candles.map((c) => parseFloat(c.low));
  const closes = candles.map((c) => parseFloat(c.close));
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

// Fungsi untuk menghitung EMA
function calculateEMA(prices, period) {
  if (prices.length < period) {
    throw new Error("Jumlah data tidak mencukupi untuk menghitung EMA.");
  }

  const multiplier = 2 / (period + 1);
  let ema =
    prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

// Fungsi untuk menghitung RSI
async function calculateRSI(candles, period) {
  const closes = candles.map((c) => parseFloat(c.close));
  const changes = closes.slice(1).map((close, i) => close - closes[i]);

  const gains = changes.map((change) => (change > 0 ? change : 0));
  const losses = changes.map((change) => (change < 0 ? Math.abs(change) : 0));

  const avgGain =
    gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
  const avgLoss =
    losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;

  let rsi = 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period; i < changes.length; i++) {
    const gain = gains[i];
    const loss = losses[i];

    const newAvgGain = (avgGain * (period - 1) + gain) / period;
    const newAvgLoss = (avgLoss * (period - 1) + loss) / period;

    rsi = 100 - 100 / (1 + newAvgGain / newAvgLoss);
  }

  return rsi;
}

// Fungsi untuk menghitung MACD
function calculateMACD(
  closingPrices,
  shortPeriod = 12,
  longPeriod = 26,
  signalPeriod = 9
) {
  const shortEMA = calculateEMA(closingPrices, shortPeriod);
  const longEMA = calculateEMA(closingPrices, longPeriod);
  const macdLine = shortEMA - longEMA;

  const signalLine = calculateEMA(
    closingPrices.slice(closingPrices.length - signalPeriod),
    signalPeriod
  );

  return { macdLine, signalLine };
}

// Fungsi untuk menghitung Bollinger Bands
function calculateBollingerBands(closingPrices, period = 20, multiplier = 2) {
  const avgPrice =
    closingPrices.slice(-period).reduce((sum, price) => sum + price, 0) /
    period;

  const stdDev = Math.sqrt(
    closingPrices
      .slice(-period)
      .map((price) => Math.pow(price - avgPrice, 2))
      .reduce((sum, sq) => sum + sq, 0) / period
  );

  return {
    upperBand: avgPrice + multiplier * stdDev,
    lowerBand: avgPrice - multiplier * stdDev,
  };
}

// Fungsi untuk memeriksa kondisi pasar ekstrem
async function checkExtremeMarketConditions(candles) {
  const atr = await calculateATR(candles, 14);

  if (atr > 0.05) {
    // Nilai ambang batas ATR disesuaikan
    console.log(
      chalk.red("Pasar terlalu volatil. Menghentikan trading sementara.")
    );
    return true;
  }
  return false;
}

// Fungsi untuk menentukan kondisi pasar
async function determineMarketCondition(candles) {
  const closingPrices = candles.map((c) => parseFloat(c.close));
  const shortEMA = calculateEMA(closingPrices.slice(-10), 5);
  const longEMA = calculateEMA(closingPrices.slice(-20), 20);
  const rsi = await calculateRSI(candles, 14);

  const { macdLine, signalLine } = calculateMACD(closingPrices);
  const { upperBand, lowerBand } = calculateBollingerBands(closingPrices);

  console.log(
    chalk.yellow(
      `Short EMA: ${shortEMA.toFixed(6)}, Long EMA: ${longEMA.toFixed(
        6
      )}, RSI: ${rsi.toFixed(2)}, MACD: ${macdLine.toFixed(
        6
      )}, Signal: ${signalLine.toFixed(6)}`
    )
  );

  if (shortEMA > longEMA && macdLine > signalLine && rsi < 70) {
    return "LONG";
  } else if (shortEMA < longEMA && macdLine < signalLine && rsi > 30) {
    return "SHORT";
  } else if (closingPrices[closingPrices.length - 1] > upperBand) {
    return "OVERBOUGHT";
  } else if (closingPrices[closingPrices.length - 1] < lowerBand) {
    return "OVERSOLD";
  } else {
    return "NEUTRAL";
  }
}

// Fungsi untuk menetapkan order grid dengan take profit dan stop loss
// Fungsi untuk menetapkan order grid dengan take profit dan trailing stop
async function placeGridOrders(currentPrice, atr, direction) {
  try {
    console.log(
      chalk.blue(
        `Menutup semua order lama sebelum membuat order grid baru (${direction})...`
      )
    );

    // Tutup semua posisi dan order lama
    await closeOpenPositions();
    await closeOpenOrders();

    console.log(chalk.blue(`Menempatkan order grid baru (${direction})...`));

    const { pricePrecision, quantityPrecision } = await getSymbolPrecision(
      SYMBOL
    );

    const buffer = currentPrice * 0.005; // Tambahkan buffer 0.5% untuk menghindari konflik harga

    for (let i = 1; i <= GRID_COUNT; i++) {
      const price =
        direction === "LONG"
          ? currentPrice - atr * i - buffer
          : currentPrice + atr * i + buffer;

      if (price <= 0 || price >= currentPrice * 2) {
        console.error(`Harga order tidak valid: ${price}`);
        continue; // Lewati jika harga tidak valid
      }

      const quantity = (BASE_USDT * LEVERAGE) / currentPrice;

      // Round price and quantity to proper precision
      const roundedPrice = parseFloat(price.toFixed(pricePrecision));
      const roundedQuantity = parseFloat(quantity.toFixed(quantityPrecision));

      // Buat order grid
      try {
        await client.futuresOrder({
          symbol: SYMBOL,
          side: direction === "LONG" ? "BUY" : "SELL",
          type: "LIMIT",
          price: roundedPrice,
          quantity: roundedQuantity,
          timeInForce: "GTC",
        });

        const takeProfitPrice =
          direction === "LONG"
            ? Math.max(roundedPrice + atr + buffer, currentPrice + buffer)
            : Math.min(roundedPrice - atr - buffer, roundedPrice - buffer);

        if (
          (direction === "LONG" && takeProfitPrice <= currentPrice) ||
          (direction === "SHORT" && takeProfitPrice >= roundedPrice)
        ) {
          console.error(
            `Harga Take Profit tidak valid untuk ${direction}: ${takeProfitPrice.toFixed(
              pricePrecision
            )} (Harga pasar: ${currentPrice.toFixed(pricePrecision)})`
          );
          continue; // Lewati jika tidak valid
        }

        await client.futuresOrder({
          symbol: SYMBOL,
          side: direction === "LONG" ? "SELL" : "BUY",
          type: "TAKE_PROFIT_MARKET",
          stopPrice: takeProfitPrice.toFixed(pricePrecision),
          quantity: roundedQuantity,
          timeInForce: "GTC",
          reduceOnly: true,
        });
        console.log(`Take Profit di harga ${takeProfitPrice} berhasil dibuat.`);

        // Tambahkan Trailing Stop
        const activationPrice =
          direction === "LONG"
            ? roundedPrice + atr * 0.5
            : roundedPrice - atr * 0.5;

        try {
          await client.futuresOrder({
            symbol: SYMBOL,
            side: direction === "LONG" ? "SELL" : "BUY",
            type: "TRAILING_STOP_MARKET",
            callbackRate: 1.0, // Callback rate dalam persentase
            quantity: roundedQuantity,
            reduceOnly: true,
          });

          console.log(
            chalk.green(
              `Trailing Stop diaktifkan pada harga ${activationPrice.toFixed(
                pricePrecision
              )} dengan callback rate 1%`
            )
          );
        } catch (error) {
          console.error(
            chalk.red(
              `Gagal membuat Trailing Stop di harga ${activationPrice.toFixed(
                pricePrecision
              )}: ${error.body || error.message}`
            )
          );
        }
      } catch (error) {
        console.error(
          `Kesalahan saat menempatkan order grid: ${error.message}`
        );
      }

      // Tambahkan jeda untuk menghindari konflik API
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log(chalk.blue("Semua order grid baru berhasil ditempatkan."));
  } catch (error) {
    console.error(
      chalk.bgRed("Kesalahan saat menempatkan order grid:"),
      error.message || error
    );
  }
}

// Fungsi trading utama
async function trade() {
  try {
    const ticker = await client.futuresPrices();
    if (!ticker[SYMBOL]) throw new Error(`Symbol ${SYMBOL} tidak ditemukan.`);

    const currentPrice = parseFloat(ticker[SYMBOL]);
    console.log(
      chalk.yellow(
        `Harga pasar terkini untuk ${SYMBOL}: ${currentPrice.toFixed(6)}`
      )
    );

    // Set leverage untuk trading
    await client.futuresLeverage({ symbol: SYMBOL, leverage: LEVERAGE });

    // Mengambil data candle
    const candles = await client.futuresCandles({
      symbol: SYMBOL,
      interval: "15m",
      limit: 50,
    });

    if (await checkExtremeMarketConditions(candles)) {
      return; // Berhenti jika pasar terlalu ekstrem
    }

    if (candles.length < 20) {
      console.warn(
        chalk.bgYellow("Data candle tidak mencukupi untuk analisis.")
      );
      return;
    }

    // Hitung ATR
    const atr = await calculateATR(candles, 14);
    console.log(chalk.yellow(`ATR saat ini: ${atr.toFixed(6)}`));

    // Tentukan kondisi pasar
    const marketCondition = await determineMarketCondition(candles);

    // Tempatkan order grid berdasarkan kondisi pasar
    if (marketCondition === "LONG" || marketCondition === "SHORT") {
      await placeGridOrders(currentPrice, atr, marketCondition);
    } else {
      console.log(
        chalk.blue(
          "Kondisi pasar netral, tidak ada order grid yang ditempatkan."
        )
      );
    }

    // Tunggu semua order selesai sebelum melanjutkan
    await waitForOrdersToComplete();
  } catch (error) {
    console.error(
      chalk.bgRed("Kesalahan utama dalam trading:"),
      error.message || error
    );
  }
}

// Loop utama untuk menjalankan bot
async function runBot() {
  await closeOpenPositions();
  await closeOpenOrders(); // Tutup order terbuka sebelum memulai trading
  while (true) {
    await trade();
    // Berikan jeda sebelum loop berikutnya
    console.log(
      chalk.magenta("Menunggu sebelum memulai iterasi berikutnya...")
    );
    await new Promise((resolve) => setTimeout(resolve, 10000)); // Jeda 10 detik
  }
}

// Memulai bot
runBot();
