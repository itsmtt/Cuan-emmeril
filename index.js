require("dotenv").config(); // Load .env file
const Binance = require("binance-api-node").default;
const chalk = require("chalk");
const fs = require("fs");

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
let config;
try {
  config = JSON.parse(fs.readFileSync("config.json", "utf8"));
} catch (error) {
  console.error(
    chalk.bgRed(
      "Gagal memuat file konfigurasi. Pastikan 'config.json' tersedia dan valid."
    )
  );
  process.exit(1);
}

const SYMBOL = config.SYMBOL;
const GRID_COUNT = config.GRID_COUNT;
const LEVERAGE = config.LEVERAGE;
const BASE_USDT = config.BASE_USDT;

let totalProfit = 0;
let totalLoss = 0;

// Fungsi untuk pencatatan total TP dan SL
function logToFile(message) {
  const logMessage = `${new Date().toISOString()} - ${message}\n`;
  fs.appendFileSync("profit_loss_logs.txt", logMessage, (err) => {
    if (err) {
      console.error(chalk.bgRed("Gagal mencatat ke file log:"), err.message);
    }
  });
}

// Fungsi untuk mendapatkan presisi pasangan perdagangan
async function getSymbolPrecision(symbol) {
  try {
    const exchangeInfo = await client.futuresExchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === symbol);
    if (!symbolInfo) throw new Error(`Symbol ${symbol} tidak ditemukan.`);
    const pricePrecision = symbolInfo.pricePrecision;
    const quantityPrecision = symbolInfo.quantityPrecision;
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
    console.error(chalk.bgRed("Kesalahan saat menutup order terbuka:"), error);
    throw error;
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
        try {
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

          // Hitung profit atau loss
          const currentPrice = parseFloat(
            position.markPrice || position.entryPrice
          );
          const entryPrice = parseFloat(position.entryPrice);
          const pnl =
            side === "SELL"
              ? (currentPrice - entryPrice) * quantity
              : (entryPrice - currentPrice) * quantity;

          if (pnl > 0) {
            totalProfit += pnl;
            const profitMessage = `Profit dari posisi pada ${
              position.symbol
            }: ${pnl.toFixed(2)} USDT`;
            console.log(chalk.green(profitMessage));
            logToFile(profitMessage);
          } else {
            totalLoss += Math.abs(pnl);
            const lossMessage = `Loss dari posisi pada ${
              position.symbol
            }: ${Math.abs(pnl).toFixed(2)} USDT`;
            console.log(chalk.red(lossMessage));
            logToFile(lossMessage);
          }
        } catch (error) {
          console.error(
            chalk.bgRed(`Gagal menutup posisi pada ${position.symbol}:`),
            error.message || error
          );
        }
      }
    }
  } catch (error) {
    console.error(
      chalk.bgRed("Kesalahan saat menutup posisi terbuka:"),
      error.message || error
    );
  }
}

// Fungsi untuk menghitung ATR
async function calculateATR(candles, period) {
  if (!candles.every((c) => c.high && c.low && c.close)) {
    throw new Error(
      "Format candle tidak valid. Pastikan data memiliki high, low, dan close."
    );
  }

  if (candles.length < period) {
    throw new Error("Jumlah candle tidak mencukupi untuk menghitung ATR.");
  }
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
  const macdLine = closingPrices
    .map((_, i) =>
      i >= longPeriod
        ? calculateEMA(closingPrices.slice(i - shortPeriod, i), shortPeriod) -
          calculateEMA(closingPrices.slice(i - longPeriod, i), longPeriod)
        : null
    )
    .filter((v) => v !== null);

  const signalLine = calculateEMA(macdLine, signalPeriod);
  return { macdLine: macdLine[macdLine.length - 1], signalLine };
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

// Fungsi untuk menghitung keanggotaan fuzzy
function fuzzyMembership(value, low, high, type = "linear") {
  switch (type) {
    case "triangle":
      const mid = (low + high) / 2;
      return value <= low
        ? 0
        : value >= high
        ? 0
        : value <= mid
        ? (value - low) / (mid - low)
        : (high - value) / (high - mid);
    case "trapezoid":
      const buffer = (high - low) * 0.1; // 10% margin
      return value <= low - buffer || value >= high + buffer
        ? 0
        : value >= low && value <= high
        ? 1
        : value < low
        ? (value - (low - buffer)) / buffer
        : (high + buffer - value) / buffer;
    case "linear":
    default:
      return value <= low
        ? 1
        : value >= high
        ? 0
        : (high - value) / (high - low);
  }
}

// Fungsi untuk menghitung sinyal fuzzy berdasarkan bobot
function aggregateFuzzySignals(signals, weights = []) {
  if (weights.length === 0)
    weights = Array(signals.length).fill(1 / signals.length); // Equal weights
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  return (
    signals.reduce((sum, signal, i) => sum + signal * weights[i], 0) /
    totalWeight
  );
}

// Fungsi untuk menghitung VWAP
function calculateVWAP(candles) {
  let cumulativeVolume = 0;
  let cumulativePriceVolume = 0;

  for (const candle of candles) {
    const high = parseFloat(candle.high);
    const low = parseFloat(candle.low);
    const close = parseFloat(candle.close);
    const volume = parseFloat(candle.volume);

    const typicalPrice = (high + low + close) / 3;
    cumulativeVolume += volume;
    cumulativePriceVolume += typicalPrice * volume;
  }

  return cumulativePriceVolume / cumulativeVolume;
}

// Fungsi untuk memeriksa kondisi pasar ekstrem
async function checkExtremeMarketConditions(atr, vwap, lastPrice, volumes) {
  const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
  const fuzzySignals = {
    highVolatility: fuzzyMembership(atr, 0.05, 0.1, "trapezoid"),
    extremeVolatility: fuzzyMembership(atr, 0.1, 0.2, "trapezoid"),
    avgVolumeSpike: fuzzyMembership(
      volumes[volumes.length - 1],
      avgVolume * 1.5,
      avgVolume * 3,
      "triangle"
    ),
    priceFarBelowVWAP: fuzzyMembership(
      lastPrice,
      vwap * 0.8,
      vwap * 0.9,
      "linear"
    ),
    priceFarAboveVWAP: fuzzyMembership(
      lastPrice,
      vwap * 1.1,
      vwap * 1.2,
      "linear"
    ),
  };

  const weights = [0.3, 0.3, 0.2, 0.1, 0.1]; // Custom weights
  const isExtreme = aggregateFuzzySignals(Object.values(fuzzySignals), weights);

  console.log(
    `Kondisi pasar ekstrem: ${(isExtreme * 100).toFixed(2)}% (ATR=${atr.toFixed(
      2
    )}, VWAP=${vwap.toFixed(2)}, Harga=${lastPrice.toFixed(2)})`
  );

  if (isExtreme >= 0.75) {
    console.log("Pasar dalam kondisi ekstrem. Menghentikan trading sementara.");
    await closeOpenPositions();
    await closeOpenOrders();
    return true;
  }
  return false;
}

// Fungsi untuk menentukan kondisi pasar
async function determineMarketCondition(
  rsi,
  vwap,
  closingPrices,
  lastPrice,
  atr
) {
  const shortEMA = calculateEMA(closingPrices.slice(-10), 5);
  const longEMA = calculateEMA(closingPrices.slice(-20), 20);
  const { macdLine, signalLine } = calculateMACD(closingPrices);
  const { upperBand, lowerBand } = calculateBollingerBands(closingPrices);

  const weights = {
    rsi: atr > 0.1 ? 0.2 : 0.3,
    macd: atr > 0.1 ? 0.25 : 0.3,
    bollinger: atr > 0.1 ? 0.35 : 0.25,
    ema: atr > 0.1 ? 0.2 : 0.15,
  };

  const fuzzySignals = {
    rsiBuy: fuzzyMembership(rsi, 30, 50),
    rsiSell: fuzzyMembership(rsi, 50, 70),
    macdBuy: macdLine > signalLine ? 1 : 0,
    macdSell: macdLine < signalLine ? 1 : 0,
    priceNearLowerBand: fuzzyMembership(lastPrice, lowerBand, lowerBand * 1.02),
    priceNearUpperBand: fuzzyMembership(lastPrice, upperBand * 0.98, upperBand),
    emaBuy: shortEMA > longEMA ? 1 : 0,
    emaSell: shortEMA < longEMA ? 1 : 0,
    priceBelowVWAP: lastPrice < vwap ? 1 : 0,
    priceAboveVWAP: lastPrice > vwap ? 1 : 0,
  };

  const buySignal = aggregateFuzzySignals([
    fuzzySignals.rsiBuy * weights.rsi,
    fuzzySignals.macdBuy * weights.macd,
    fuzzySignals.priceNearLowerBand * weights.bollinger,
    fuzzySignals.priceBelowVWAP * weights.ema,
    fuzzySignals.emaBuy * weights.ema,
  ]);

  const sellSignal = aggregateFuzzySignals([
    fuzzySignals.rsiSell * weights.rsi,
    fuzzySignals.macdSell * weights.macd,
    fuzzySignals.priceNearUpperBand * weights.bollinger,
    fuzzySignals.priceAboveVWAP * weights.ema,
    fuzzySignals.emaSell * weights.ema,
  ]);

  console.log(
    `Fuzzy Signals: BUY = ${(buySignal * 100).toFixed(2)}% >= 75%, SELL = ${(
      sellSignal * 100
    ).toFixed(2)}% >= 75%`
  );

  if (buySignal > sellSignal && buySignal >= 0.75) {
    console.log(`Posisi sekarang LONG (indikator menunjukkan peluang beli).`);
    return "LONG";
  } else if (sellSignal > buySignal && sellSignal >= 0.75) {
    console.log(`Posisi sekarang SHORT (indikator menunjukkan peluang jual).`);
    return "SHORT";
  } else {
    console.log(`Posisi sekarang NEUTRAL. Menunggu.`);
    return "NEUTRAL";
  }
}

// Fungsi untuk menetapkan order grid
async function placeGridOrders(currentPrice, atr, direction) {
  await closeOpenPositions();
  await closeOpenOrders();

  const exchangeInfo = await client.futuresExchangeInfo();
  const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === SYMBOL);
  if (!symbolInfo) {
    console.error(`Symbol ${SYMBOL} tidak ditemukan di Binance.`);
    return;
  }

  const { pricePrecision, quantityPrecision } = await getSymbolPrecision(
    SYMBOL
  );

  const tickSize = parseFloat(
    symbolInfo.filters.find((f) => f.tickSize).tickSize
  );

  const buffer = atr;
  const orderGrid = GRID_COUNT;
  const openOrders = await client.futuresOpenOrders({ symbol: SYMBOL });
  const batchOrders = [];

  for (let i = 1; i <= orderGrid; i++) {
    const price =
      direction === "LONG"
        ? currentPrice - buffer * i
        : currentPrice + buffer * i;

    const roundedPrice = parseFloat(
      (Math.round(price / tickSize) * tickSize).toFixed(pricePrecision)
    );

    const quantity = parseFloat(
      ((BASE_USDT * LEVERAGE) / currentPrice).toFixed(quantityPrecision)
    );

    if (
      openOrders.some(
        (order) =>
          parseFloat(order.price).toFixed(pricePrecision) ===
          roundedPrice.toFixed(pricePrecision)
      )
    ) {
      continue;
    }

    batchOrders.push({
      symbol: SYMBOL,
      side: direction === "LONG" ? "BUY" : "SELL",
      type: "LIMIT",
      price: roundedPrice,
      quantity: quantity,
      timeInForce: "GTC",
    });
  }

  if (batchOrders.length > 0) {
    for (const order of batchOrders) {
      try {
        await client.futuresOrder(order);
      } catch (error) {
        console.error(
          chalk.bgRed(`Gagal menempatkan order: ${error.message || error}`)
        );
      }
    }
    await placeTakeProfitAndStopLoss(batchOrders, atr, direction);
  } else {
    console.log(chalk.yellow("Tidak ada order baru yang ditempatkan."));
  }
}

// Fungsi untuk menetapkan TP dan SL
async function placeTakeProfitAndStopLoss(orders, atr, direction) {
  try {
    console.log(
      chalk.blue("Menetapkan Take Profit dan Stop Loss untuk order...")
    );

    for (const order of orders) {
      const { price, quantity, symbol } = order;

      // Gunakan harga order sebagai referensi
      const orderPrice = parseFloat(price);

      // Ambil presisi harga
      const { pricePrecision } = await getSymbolPrecision(symbol);

      // Hitung keanggotaan fuzzy volatilitas
      const fuzzySignals = {
        highVolatility: fuzzyMembership(atr, 0.05, 0.1),
        extremeVolatility: fuzzyMembership(atr, 0.1, 0.2),
      };
      const volatilityFactor = fuzzySignals.highVolatility * 2; // Buffer adaptif
      const buffer = atr * volatilityFactor; // Buffer berbasis ATR dan volatilitas

      // Hitung harga TP dan SL
      const takeProfitPrice =
        direction === "LONG" ? orderPrice + buffer : orderPrice - buffer;

      const stopLossPrice =
        direction === "LONG" ? orderPrice - buffer : orderPrice + buffer;

      // Bulatkan harga berdasarkan presisi
      const roundedTP = parseFloat(takeProfitPrice.toFixed(pricePrecision));
      const roundedSL = parseFloat(stopLossPrice.toFixed(pricePrecision));

      // Validasi harga agar tidak memicu langsung
      if (
        (direction === "LONG" && roundedSL >= orderPrice) ||
        (direction === "SHORT" && roundedSL <= orderPrice)
      ) {
        console.log(chalk.red("Stop Loss terlalu dekat, melewati order asli."));
        continue;
      }

      if (
        (direction === "LONG" && roundedTP <= orderPrice) ||
        (direction === "SHORT" && roundedTP >= orderPrice)
      ) {
        console.log(
          chalk.red("Take Profit terlalu dekat, melewati order asli.")
        );
        continue;
      }

      // Jeda waktu untuk memastikan Binance memproses order sebelumnya
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Tunggu 1 detik

      // Perbarui daftar order terbuka
      const updatedOpenOrders = await client.futuresOpenOrders({
        symbol: SYMBOL,
      });

      // Cek apakah TP sudah ada
      const tpExists = updatedOpenOrders.some(
        (o) =>
          o.type === "TAKE_PROFIT_MARKET" &&
          parseFloat(o.stopPrice).toFixed(pricePrecision) ===
            roundedTP.toFixed(pricePrecision)
      );

      // Cek apakah SL sudah ada
      const slExists = updatedOpenOrders.some(
        (o) =>
          o.type === "STOP_MARKET" &&
          parseFloat(o.stopPrice).toFixed(pricePrecision) ===
            roundedSL.toFixed(pricePrecision)
      );

      // Skip jika TP atau SL sudah ada
      if (tpExists) {
        console.log(
          chalk.yellow(`Take Profit pada harga ${roundedTP} sudah ada.`)
        );
      } else {
        // Buat order Take Profit
        await client.futuresOrder({
          symbol,
          side: direction === "LONG" ? "SELL" : "BUY",
          type: "TAKE_PROFIT_MARKET",
          stopPrice: roundedTP,
          quantity,
          reduceOnly: true,
        });

        console.log(
          chalk.green(
            `Take Profit untuk ${symbol} pada harga ${roundedTP} berhasil ditempatkan.`
          )
        );
      }

      if (slExists) {
        console.log(
          chalk.yellow(`Stop Loss pada harga ${roundedSL} sudah ada.`)
        );
      } else {
        // Buat order Stop Loss
        await client.futuresOrder({
          symbol,
          side: direction === "LONG" ? "SELL" : "BUY",
          type: "STOP_MARKET",
          stopPrice: roundedSL,
          quantity,
          reduceOnly: true,
        });

        console.log(
          chalk.green(
            `Stop Loss untuk ${symbol} pada harga ${roundedSL} berhasil ditempatkan.`
          )
        );
      }

      // Place trailing stop
      await placeTrailingStop(order, atr, direction);
    }
  } catch (error) {
    console.error(
      chalk.bgRed("Kesalahan saat menetapkan Take Profit dan Stop Loss:"),
      error.message || error
    );
  }
}

// Add a trailing stop mechanism
async function placeTrailingStop(order, atr, direction) {
  try {
    const { price, quantity, symbol } = order;
    const orderPrice = parseFloat(price);
    const { pricePrecision } = await getSymbolPrecision(symbol);

    // Hitung keanggotaan fuzzy volatilitas
    const fuzzySignals = {
      highVolatility: fuzzyMembership(atr, 0.05, 0.1),
      extremeVolatility: fuzzyMembership(atr, 0.1, 0.2),
    };
    const volatilityFactor = fuzzySignals.highVolatility * 1.5;
    const buffer = atr * volatilityFactor;

    const trailingStopPrice =
      direction === "LONG" ? orderPrice + buffer : orderPrice - buffer; // Adjust activation price to avoid immediate trigger
    const roundedTrailingStop = parseFloat(
      trailingStopPrice.toFixed(pricePrecision)
    );

    // Determine callbackRate based on the percentage of trailingStopPrice from orderPrice
    const percentageDifference = Math.abs(
      ((trailingStopPrice - orderPrice) / orderPrice) * 100
    );
    let rate = Math.min(Math.max(percentageDifference, 0.1), 5.0); // Ensure rate is between 0.1 and 5.0

    await client.futuresOrder({
      symbol,
      side: direction === "LONG" ? "SELL" : "BUY",
      type: "TRAILING_STOP_MARKET",
      activationPrice: roundedTrailingStop,
      callbackRate: rate.toFixed(1),
      quantity,
      reduceOnly: true,
    });

    console.log(
      chalk.green(
        `Trailing Stop for ${symbol} at price ${roundedTrailingStop} with callback rate ${rate}% successfully placed.`
      )
    );
  } catch (error) {
    console.error(
      chalk.bgRed("Error placing trailing stop:"),
      error.message || error
    );
  }
}

// Fungsi untuk memantau status order terbuka dan mengambil tindakan
async function monitorOrders() {
  try {
    console.log(chalk.blue("Memeriksa status order terbuka..."));

    // Ambil semua order terbuka
    const openOrders = await client.futuresOpenOrders({ symbol: SYMBOL });

    // Ambil semua data posisi terbuka
    const positions = await client.futuresPositionRisk();

    // Filter order terbuka dengan tipe TAKE_PROFIT_MARKET
    const takeProfitOrders = openOrders.filter(
      (order) => order.type === "TAKE_PROFIT_MARKET"
    );

    // Filter order terbuka dengan tipe STOP_MARKET
    const stopLossOrders = openOrders.filter(
      (order) => order.type === "STOP_MARKET"
    );

    // Filter order terbuka dengan limit order
    const limitOrders = openOrders.filter((order) => order.type === "LIMIT");

    // Filter order terbuka dengan tipe TRAILING_STOP_MARKET
    const trailingStopOrders = openOrders.filter(
      (order) => order.type === "TRAILING_STOP_MARKET"
    );

    // Cari posisi terbuka
    const openPosition = positions.find(
      (position) => parseFloat(position.positionAmt) !== 0
    );

    // monitoring trailing stop
    if (trailingStopOrders.length === 0) {
      console.log(
        chalk.red("Tidak ada Trailing Stop order di daftar open orders.")
      );
    } else {
      if (trailingStopOrders.length > 0) {
        console.log(
          chalk.green(
            `Masih ada ${trailingStopOrders.length} Trailing Stop order yang aktif.`
          )
        );
      }
    }

    // Jika tidak ada TP Tutup semua order terbuka dan posisi terbuka
    if (takeProfitOrders.length === 0) {
      console.log(
        chalk.red("Tidak ada Take Profit order di daftar open orders.")
      );
      console.log(chalk.blue("Menutup semua posisi dan order..."));
      await closeOpenPositions();
      console.log(chalk.green("Semua posisi telah ditutup."));
      await closeOpenOrders();
      console.log(chalk.green("Semua order telah dibatalkan."));
    } else {
      console.log(
        chalk.green(
          `Masih ada ${takeProfitOrders.length} Take Profit order yang aktif.`
        )
      );
    }

    // Jika tidak ada SL Tutup semua order terbuka dan posisi terbuka
    if (stopLossOrders.length === 0) {
      console.log(
        chalk.red("Tidak ada Stop Loss order di daftar open orders.")
      );
      console.log(chalk.blue("Menutup semua posisi dan order..."));
      await closeOpenPositions();
      console.log(chalk.green("Semua posisi telah ditutup."));
      await closeOpenOrders();
      console.log(chalk.green("Semua order telah dibatalkan."));
    } else {
      console.log(
        chalk.green(
          `Masih ada ${stopLossOrders.length} Stop Loss order yang aktif.`
        )
      );
    }

    // Jika tidak ada limit order dan tidak ada posisi terbuka Tutup semua order terbuka dan posisi terbuka
    if (limitOrders.length === 0 && !openPosition) {
      console.log(chalk.red("Tidak ada limit order atau posisi terbuka."));
      await closeOpenOrders();
      console.log(chalk.green("Semua limit order telah dibatalkan."));
      await closeOpenPositions();
      console.log(chalk.green("Semua posisi telah ditutup."));
    } else {
      if (limitOrders.length > 0) {
        console.log(
          chalk.green(`Masih ada ${limitOrders.length} limit order yang aktif.`)
        );
      }

      // Posisi terbuka saat ini
      if (openPosition) {
        console.log(
          chalk.green(`Masih ada posisi terbuka pada ${openPosition.symbol}.`)
        );
      }
    }
  } catch (error) {
    console.error(
      chalk.bgRed("Kesalahan saat memantau order terbuka:"),
      error.message || error
    );
  }
}

// Fungsi trading utama
async function trade() {
  try {
    const ticker = await client.futuresPrices();
    if (!ticker[SYMBOL]) throw new Error(`Symbol ${SYMBOL} tidak ditemukan.`);

    // Set leverage untuk trading
    try {
      await client.futuresLeverage({ symbol: SYMBOL, leverage: LEVERAGE });
    } catch (error) {
      console.error(
        chalk.bgRed(`Gagal menetapkan leverage: ${error.message || error}`)
      );
      return;
    }

    // Mengambil data candle
    const candles = await client.futuresCandles({
      symbol: SYMBOL,
      interval: "15m",
    });

    // validasi candles
    if (candles.length < 20) {
      console.warn(
        chalk.bgYellow("Data candle tidak mencukupi untuk analisis.")
      );
      return;
    }

    // harga pasar terkini
    const currentPrice = parseFloat(ticker[SYMBOL]);
    console.log(
      chalk.yellow(
        `Harga pasar terkini untuk ${SYMBOL}: ${currentPrice.toFixed(6)}`
      )
    );

    // harga penutupan pasar untuk fuzzy member
    const lastPrice = parseFloat(candles[candles.length - 1].close);

    // harga penutupan pasar
    const closinglastPricePrices = candles.map((c) => parseFloat(c.close));

    // Hitung ATR
    const atr = await calculateATR(candles, 14);

    // Hitung VWAP
    const vwap = await calculateVWAP(candles);

    // Hitung RSI
    const rsi = await calculateRSI(candles, 14);

    // Hitung VOLUMES
    const volumes = candles.map((c) => parseFloat(c.volume));

    // Periksa apakah masih ada order terbuka
    const openOrders = await client.futuresOpenOrders({ symbol: SYMBOL });
    if (openOrders.length > 0) {
      // Berhenti jika pasar terlalu ekstrem
      if (await checkExtremeMarketConditions(atr, vwap, lastPrice, volumes)) {
        return;
      }

      // Tentukan kondisi pasar
      const marketCondition = await determineMarketCondition(
        rsi,
        vwap,
        closinglastPricePrices,
        lastPrice
      );

      // Ambil semua limit order terbuka
      const hasOpenOrders = await client.futuresOpenOrders({ symbol: SYMBOL });
      const limitBuyOrders = hasOpenOrders.filter(
        (order) => order.side === "BUY" && order.type === "LIMIT"
      );
      const limitSellOrders = hasOpenOrders.filter(
        (order) => order.side === "SELL" && order.type === "LIMIT"
      );

      // Periksa apakah arah pasar bertentangan dengan limit order terbuka
      const conflictingBuyOrders =
        limitBuyOrders.length > 0 && marketCondition === "SHORT";
      const conflictingSellOrders =
        limitSellOrders.length > 0 && marketCondition === "LONG";

      if (conflictingBuyOrders || conflictingSellOrders) {
        console.log(
          chalk.red(
            "Kondisi pasar berlawanan dengan limit orders yang terbuka. Menutup semua order."
          )
        );
        await closeOpenOrders();
        await closeOpenPositions();
        return;
      } else {
        console.log(
          chalk.green(
            "Kondisi pasar masih sesuai dengan limit orders yang ada. Tidak ada tindakan yang diperlukan."
          )
        );
      }

      // Ambil semua posisi terbuka
      const positions = await client.futuresPositionRisk();
      const openPosition = positions.find(
        (position) => parseFloat(position.positionAmt) !== 0
      );

      // Periksa apakah arah pasar bertentangan dengan posisi terbuka
      if (openPosition) {
        const positionSide =
          parseFloat(openPosition.positionAmt) > 0 ? "LONG" : "SHORT";

        if (
          (marketCondition === "LONG" && positionSide === "SHORT") ||
          (marketCondition === "SHORT" && positionSide === "LONG")
        ) {
          console.log(
            chalk.red(
              `Kondisi pasar (${marketCondition}) bertentangan dengan posisi terbuka (${positionSide}). Menutup posisi...`
            )
          );
          await closeOpenOrders();
          await closeOpenPositions();
          return;
        } else {
          console.log(
            chalk.green(
              `Kondisi pasar (${marketCondition}) sejalan dengan posisi terbuka (${positionSide}). Tidak ada tindakan yang diperlukan.`
            )
          );
        }
      }

      // Memantau status TP dan SL
      await monitorOrders();
      console.log(
        chalk.blue(`Masih ada ${openOrders.length} order terbuka. Menunggu...`)
      );

      // Logging Total Profit dan Loss
      const totalProfitMessage = `Total Profit: ${totalProfit.toFixed(2)} USDT`;
      const totalLossMessage = `Total Loss: ${totalLoss.toFixed(2)} USDT`;

      console.log(chalk.yellow(totalProfitMessage));
      console.log(chalk.yellow(totalLossMessage));

      logToFile(totalProfitMessage);
      logToFile(totalLossMessage);

      return;
    }

    // Kondisi pasar extreme
    if (await checkExtremeMarketConditions(atr, vwap, lastPrice, volumes)) {
      return;
    }

    // Tentukan kondisi pasar
    const marketCondition = await determineMarketCondition(
      rsi,
      vwap,
      closinglastPricePrices,
      lastPrice
    );

    // Tempatkan order grid jika ada sinyal trading
    if (marketCondition === "LONG" || marketCondition === "SHORT") {
      console.log(
        chalk.blue(
          `Sinyal order baru terdeteksi: ${marketCondition}. Menempatkan order grid.`
        )
      );

      // Buka order sesuai sinyal
      await placeGridOrders(currentPrice, atr, marketCondition);

      // Buka posisi sesuai sinyal
      const direction = marketCondition === "LONG" ? "BUY" : "SELL";
      const { quantityPrecision } = await getSymbolPrecision(SYMBOL);
      const quantity = parseFloat(
        ((BASE_USDT * LEVERAGE) / currentPrice).toFixed(quantityPrecision)
      );

      try {
        await client.futuresOrder({
          symbol: SYMBOL,
          side: direction,
          type: "MARKET",
          quantity: quantity,
        });
        console.log(
          chalk.green(
            `Posisi ${marketCondition} berhasil dibuka dengan kuantitas ${quantity}.`
          )
        );
      } catch (error) {
        console.error(
          chalk.bgRed(`Gagal membuka posisi: ${error.message || error}`)
        );
      }
    } else {
      console.log(chalk.blue("Tidak ada sinyal order baru, menunggu..."));
    }

    // Logging Total Profit dan Loss
    const totalProfitMessage = `Total Profit: ${totalProfit.toFixed(2)} USDT`;
    const totalLossMessage = `Total Loss: ${totalLoss.toFixed(2)} USDT`;

    console.log(chalk.yellow(totalProfitMessage));
    console.log(chalk.yellow(totalLossMessage));

    logToFile(totalProfitMessage);
    logToFile(totalLossMessage);
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
  await closeOpenOrders();
  while (true) {
    await trade();
    console.log(
      chalk.magenta("Menunggu sebelum memulai iterasi berikutnya...")
    );
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}

// Memulai bot
runBot();
