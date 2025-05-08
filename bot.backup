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
  if (!candles.every(c => c.high && c.low && c.close)) {
    throw new Error("Format candle tidak valid. Pastikan data memiliki high, low, dan close.");
  }

  const len = candles.length;
  if (len < period + 1) {
    throw new Error("Jumlah candle tidak mencukupi untuk menghitung ATR.");
  }

  let trSum = 0;
  for (let i = len - period; i < len; i++) {
    const high = parseFloat(candles[i].high);
    const low = parseFloat(candles[i].low);
    const prevClose = parseFloat(candles[i - 1].close);

    const highLow = high - low;
    const highClose = Math.abs(high - prevClose);
    const lowClose = Math.abs(low - prevClose);

    trSum += Math.max(highLow, highClose, lowClose);
  }

  return trSum / period;
}


// Fungsi untuk menghitung EMA
function calculateEMA(prices, period) {
  const len = prices.length;
  if (len < period) {
    throw new Error("Jumlah data tidak mencukupi untuk menghitung EMA.");
  }

  const multiplier = 2 / (period + 1);

  // Hitung SMA sebagai EMA awal
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  let ema = sum / period;

  // Lanjutkan dengan rumus EMA
  for (let i = period; i < len; i++) {
    ema += (prices[i] - ema) * multiplier;
  }

  return ema;
}


// Fungsi untuk menghitung RSI
async function calculateRSI(candles, period) {
  const closes = candles.map(c => parseFloat(c.close));
  const len = closes.length;

  if (len <= period) {
    throw new Error("Jumlah data tidak mencukupi untuk menghitung RSI.");
  }

  let gainSum = 0;
  let lossSum = 0;

  // Hitung rata-rata awal
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) {
      gainSum += change;
    } else {
      lossSum += Math.abs(change);
    }
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  let rsi = 100 - 100 / (1 + avgGain / avgLoss);

  // Iterasi untuk sisa data
  for (let i = period + 1; i < len; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rsi = 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}


// Fungsi untuk menghitung MACD
function calculateEMAArray(prices, period) {
  const result = [];
  const multiplier = 2 / (period + 1);
  let sum = 0;

  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }

  let ema = sum / period;
  result[period - 1] = ema;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
    result[i] = ema;
  }

  return result;
}

function calculateMACD(prices, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
  if (prices.length < longPeriod + signalPeriod) {
    throw new Error("Data harga tidak mencukupi untuk menghitung MACD.");
  }

  const shortEMA = calculateEMAArray(prices, shortPeriod);
  const longEMA = calculateEMAArray(prices, longPeriod);

  const macdLine = [];
  for (let i = 0; i < prices.length; i++) {
    if (shortEMA[i] !== undefined && longEMA[i] !== undefined) {
      macdLine[i] = shortEMA[i] - longEMA[i];
    }
  }

  const validMacdLine = macdLine.filter((v) => v !== undefined);
  const signalLine = calculateEMA(validMacdLine, signalPeriod);

  return {
    macdLine: validMacdLine[validMacdLine.length - 1],
    signalLine,
  };
}


// Fungsi untuk menghitung Bollinger Bands
function calculateBollingerBands(closingPrices, period = 20, multiplier = 2) {
  const len = closingPrices.length;
  if (len < period) {
    throw new Error("Jumlah data tidak mencukupi untuk menghitung Bollinger Bands.");
  }

  let sum = 0;
  for (let i = len - period; i < len; i++) {
    sum += closingPrices[i];
  }
  const avg = sum / period;

  let varianceSum = 0;
  for (let i = len - period; i < len; i++) {
    const diff = closingPrices[i] - avg;
    varianceSum += diff * diff;
  }

  const stdDev = Math.sqrt(varianceSum / period);

  return {
    upperBand: avg + multiplier * stdDev,
    lowerBand: avg - multiplier * stdDev,
  };
}


// Fungsi untuk menghitung keanggotaan fuzzy
function fuzzyMembership(value, low, high, type = "linear") {
  if (type === "triangle") {
    if (value <= low || value >= high) return 0;
    const mid = (low + high) / 2;
    return value <= mid
      ? (value - low) / (mid - low)
      : (high - value) / (high - mid);
  }

  if (type === "trapezoid") {
    const buffer = (high - low) * 0.1;
    if (value <= low - buffer || value >= high + buffer) return 0;
    if (value >= low && value <= high) return 1;
    return value < low
      ? (value - (low - buffer)) / buffer
      : (high + buffer - value) / buffer;
  }

  // Default to linear
  if (value <= low) return 1;
  if (value >= high) return 0;
  return (high - value) / (high - low);
}


// Fungsi untuk menghitung sinyal fuzzy berdasarkan bobot
function aggregateFuzzySignals(signals, weights = []) {
  const len = signals.length;
  if (len === 0) return 0;

  let total = 0;
  let weightSum = 0;

  if (weights.length === 0) {
    const equalWeight = 1 / len;
    for (let i = 0; i < len; i++) {
      total += signals[i] * equalWeight;
    }
    return total;
  }

  for (let i = 0; i < len; i++) {
    total += signals[i] * weights[i];
    weightSum += weights[i];
  }

  return total / weightSum;
}


// Fungsi untuk menghitung VWAP
function calculateVWAP(candles) {
  let cumulativeVolume = 0;
  let cumulativePriceVolume = 0;

  for (let i = 0; i < candles.length; i++) {
    const { high, low, close, volume } = candles[i];

    const h = +high;
    const l = +low;
    const c = +close;
    const v = +volume;

    const typicalPrice = (h + l + c) / 3;
    cumulativeVolume += v;
    cumulativePriceVolume += typicalPrice * v;
  }

  return cumulativeVolume === 0 ? 0 : cumulativePriceVolume / cumulativeVolume;
}


// Fungsi untuk memeriksa kondisi pasar ekstrem
async function checkExtremeMarketConditions(atr, vwap, lastPrice, volumes) {
  if (volumes.length === 0) return false;

  let sumVolume = 0;
  let lastVolume = 0;

  for (let i = 0; i < volumes.length; i++) {
    const vol = volumes[i];
    sumVolume += vol;
    if (i === volumes.length - 1) lastVolume = vol;
  }

  const avgVolume = sumVolume / volumes.length;

  const avgVol15 = avgVolume * 1.5;
  const avgVol30 = avgVolume * 3;
  const vwap80 = vwap * 0.8;
  const vwap90 = vwap * 0.9;
  const vwap110 = vwap * 1.1;
  const vwap120 = vwap * 1.2;

  const fuzzySignals = [
    fuzzyMembership(atr, 0.05, 0.1, "trapezoid"),
    fuzzyMembership(atr, 0.1, 0.2, "trapezoid"),
    fuzzyMembership(lastVolume, avgVol15, avgVol30, "triangle"),
    fuzzyMembership(lastPrice, vwap80, vwap90, "linear"),
    fuzzyMembership(lastPrice, vwap110, vwap120, "linear"),
  ];

  const isExtreme = aggregateFuzzySignals(fuzzySignals, [0.2, 0.2, 0.2, 0.2, 0.2]);

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
async function determineMarketCondition(rsi, vwap, closingPrices, lastPrice, atr) {
  const len = closingPrices.length;
  const shortEMA = calculateEMA(closingPrices.slice(len - 10), 5);
  const longEMA = calculateEMA(closingPrices.slice(len - 20), 20);
  const { macdLine, signalLine } = calculateMACD(closingPrices);
  const { upperBand, lowerBand } = calculateBollingerBands(closingPrices);

  const threshold = atr > 0.1 ? 0.8 : atr < 0.05 ? 0.65 : 0.75;

  const emaBuy = shortEMA > longEMA ? 1 : 0;
  const emaSell = shortEMA < longEMA ? 1 : 0;
  const macdBuy = macdLine > signalLine ? 1 : 0;
  const macdSell = macdLine < signalLine ? 1 : 0;

  const lowerBandUp = lowerBand * 1.02;
  const upperBandDown = upperBand * 0.98;
  const vwapLow = vwap * 0.95;
  const vwapHigh = vwap * 1.05;

  const buySignal = aggregateFuzzySignals([
    fuzzyMembership(rsi, 30, 50, "linear"),
    macdBuy,
    fuzzyMembership(lastPrice, lowerBand, lowerBandUp, "trapezoid"),
    fuzzyMembership(lastPrice, vwapLow, vwap, "linear"),
    emaBuy,
  ]);

  const sellSignal = aggregateFuzzySignals([
    fuzzyMembership(rsi, 50, 70, "linear"),
    macdSell,
    fuzzyMembership(lastPrice, upperBandDown, upperBand, "trapezoid"),
    fuzzyMembership(lastPrice, vwap, vwapHigh, "linear"),
    emaSell,
  ]);

  console.log(
    `Fuzzy Signals: BUY = ${(buySignal * 100).toFixed(2)}% >= ${(
      threshold * 100
    ).toFixed(2)}%, SELL = ${(sellSignal * 100).toFixed(2)}% >= ${(
      threshold * 100
    ).toFixed(2)}%`
  );

  if (buySignal > sellSignal && buySignal >= threshold) {
    console.log("Posisi sekarang LONG (indikator menunjukkan peluang beli).");
    return "LONG";
  } else if (sellSignal > buySignal && sellSignal >= threshold) {
    console.log("Posisi sekarang SHORT (indikator menunjukkan peluang jual).");
    return "SHORT";
  } else {
    console.log("Posisi sekarang NEUTRAL. Menunggu.");
    return "NEUTRAL";
  }
}


// Fungsi untuk menetapkan order grid
async function placeGridOrders(currentPrice, atr, direction, skipCleanup = false) {
  if (!skipCleanup) {
    await closeOpenPositions();
    await closeOpenOrders();
  }

  const exchangeInfo = await client.futuresExchangeInfo();
  const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === SYMBOL);
  if (!symbolInfo) {
    console.error(`Symbol ${SYMBOL} tidak ditemukan di Binance.`);
    return;
  }

  const { pricePrecision, quantityPrecision } = await getSymbolPrecision(SYMBOL);
  const tickSize = parseFloat(symbolInfo.filters.find((f) => f.tickSize).tickSize);
  const buffer = atr;
  const orderGrid = GRID_COUNT;

  const openOrders = await client.futuresOpenOrders({ symbol: SYMBOL });
  const existingPrices = new Set(
    openOrders.map((order) => parseFloat(order.price).toFixed(pricePrecision))
  );

  const quantity = parseFloat(((BASE_USDT * LEVERAGE) / currentPrice).toFixed(quantityPrecision));
  const batchOrders = [];

  for (let i = 1; i <= orderGrid; i++) {
    const price = direction === "LONG"
      ? currentPrice - buffer * i
      : currentPrice + buffer * i;

    const roundedPrice = parseFloat(
      (Math.round(price / tickSize) * tickSize).toFixed(pricePrecision)
    );

    if (existingPrices.has(roundedPrice.toFixed(pricePrecision))) {
      continue;
    }

    batchOrders.push({
      symbol: SYMBOL,
      side: direction === "LONG" ? "BUY" : "SELL",
      type: "LIMIT",
      price: roundedPrice,
      quantity,
      timeInForce: "GTC",
    });
  }

  if (batchOrders.length > 0) {
    const results = await Promise.allSettled(
      batchOrders.map(order => client.futuresOrder(order))
    );

    results.forEach((res, i) => {
      if (res.status === 'rejected') {
        console.error(chalk.bgRed(`Gagal menempatkan order: ${res.reason.message || res.reason}`));
      }
    });

    await placeTakeProfitAndStopLoss(batchOrders, atr, direction);
  } else {
    console.log(chalk.yellow("Tidak ada order baru yang ditempatkan."));
  }
}


// Fungsi untuk menetapkan TP dan SL
async function placeTakeProfitAndStopLoss(orders, atr, direction) {
  try {
    console.log(chalk.blue("Menetapkan Take Profit dan Stop Loss untuk order..."));

    const exchangeInfo = await client.futuresExchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === orders[0].symbol);

    const pricePrecision = symbolInfo.pricePrecision;
    const tickSize = parseFloat(symbolInfo.filters.find(f => f.filterType === "PRICE_FILTER").tickSize);
    const minStopDistance = parseFloat(symbolInfo.filters.find(f => f.filterType === "PERCENT_PRICE").multiplierUp || 0.1) * atr;

    // Gunakan buffer minimum yang wajar: ATR + max(10% ATR, minStopDistance)
    const buffer = atr + Math.max(atr * 0.1, minStopDistance);

    for (const order of orders) {
      const { price, quantity, symbol } = order;
      const orderPrice = parseFloat(price);

      let takeProfitPrice, stopLossPrice;

      if (direction === "LONG") {
        takeProfitPrice = orderPrice + buffer;
        stopLossPrice = orderPrice - buffer;
      } else {
        takeProfitPrice = orderPrice - buffer;
        stopLossPrice = orderPrice + buffer;
      }

      // Pembulatan ke tickSize
      const roundedTP = parseFloat((Math.round(takeProfitPrice / tickSize) * tickSize).toFixed(pricePrecision));
      const roundedSL = parseFloat((Math.round(stopLossPrice / tickSize) * tickSize).toFixed(pricePrecision));

      if ((direction === "LONG" && roundedSL >= orderPrice) ||
          (direction === "SHORT" && roundedSL <= orderPrice)) {
        console.log(chalk.red("Stop Loss terlalu dekat, melewati order asli."));
        continue;
      }

      if ((direction === "LONG" && roundedTP <= orderPrice) ||
          (direction === "SHORT" && roundedTP >= orderPrice)) {
        console.log(chalk.red("Take Profit terlalu dekat, melewati order asli."));
        continue;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      const updatedOpenOrders = await client.futuresOpenOrders({ symbol });

      const tpExists = updatedOpenOrders.some(
        o => o.type === "TAKE_PROFIT_MARKET" &&
             parseFloat(o.stopPrice).toFixed(pricePrecision) === roundedTP.toFixed(pricePrecision)
      );

      const slExists = updatedOpenOrders.some(
        o => o.type === "STOP_MARKET" &&
             parseFloat(o.stopPrice).toFixed(pricePrecision) === roundedSL.toFixed(pricePrecision)
      );

      if (!tpExists) {
        await client.futuresOrder({
          symbol,
          side: direction === "LONG" ? "SELL" : "BUY",
          type: "TAKE_PROFIT_MARKET",
          stopPrice: roundedTP,
          quantity,
          reduceOnly: true,
        });
        console.log(chalk.green(`TP ${symbol} @ ${roundedTP} berhasil ditempatkan.`));
      } else {
        console.log(chalk.yellow(`TP @ ${roundedTP} sudah ada.`));
      }

      if (!slExists) {
        await client.futuresOrder({
          symbol,
          side: direction === "LONG" ? "SELL" : "BUY",
          type: "STOP_MARKET",
          stopPrice: roundedSL,
          quantity,
          reduceOnly: true,
        });
        console.log(chalk.green(`SL ${symbol} @ ${roundedSL} berhasil ditempatkan.`));
      } else {
        console.log(chalk.yellow(`SL @ ${roundedSL} sudah ada.`));
      }
    }
  } catch (error) {
    console.error(chalk.bgRed("Kesalahan saat menetapkan TP/SL:"), error.message || error);
  }
}



// Fungsi untuk memantau status order terbuka dan mengambil tindakan
async function monitorOrders() {
  try {
    console.log(chalk.blue("Memeriksa status order terbuka..."));

    const openOrders = await client.futuresOpenOrders({ symbol: SYMBOL });
    const positions = await client.futuresPositionRisk();
    const openPosition = positions.find(
      (position) => parseFloat(position.positionAmt) !== 0
    );

    const takeProfitOrders = openOrders.filter(
      (order) => order.type === "TAKE_PROFIT_MARKET"
    );
    const stopLossOrders = openOrders.filter(
      (order) => order.type === "STOP_MARKET"
    );
    const limitOrders = openOrders.filter((order) => order.type === "LIMIT");

    let shouldCloseAll = false;

    if (takeProfitOrders.length === 0) {
      console.log(chalk.red("Tidak ada Take Profit aktif."));
      shouldCloseAll = true;
    } else {
      console.log(
        chalk.green(`${takeProfitOrders.length} Take Profit aktif.`)
      );
    }

    if (stopLossOrders.length === 0) {
      console.log(chalk.red("Tidak ada Stop Loss aktif."));
      shouldCloseAll = true;
    } else {
      console.log(
        chalk.green(`${stopLossOrders.length} Stop Loss aktif.`)
      );
    }

    if (limitOrders.length === 0 && !openPosition) {
      console.log(chalk.red("Tidak ada limit order atau posisi terbuka."));
      shouldCloseAll = true;
    } else {
      if (limitOrders.length > 0) {
        console.log(chalk.green(`${limitOrders.length} limit order aktif.`));
      }
      if (openPosition) {
        console.log(
          chalk.green(`Masih ada posisi terbuka di ${openPosition.symbol}.`)
        );
      }
    }

    if (shouldCloseAll) {
      console.log(chalk.blue("Menutup semua posisi dan order..."));
      await closeOpenPositions();
      console.log(chalk.green("Semua posisi telah ditutup."));
      await closeOpenOrders();
      console.log(chalk.green("Semua order telah dibatalkan."));
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
    const price = ticker[SYMBOL];
    if (!price) throw new Error(`Symbol ${SYMBOL} tidak ditemukan.`);

    const currentPrice = parseFloat(price);
    console.log(chalk.yellow(`Harga pasar terkini ${SYMBOL}: ${currentPrice.toFixed(6)}`));

    // Set leverage jika belum
    try {
      await client.futuresLeverage({ symbol: SYMBOL, leverage: LEVERAGE });
    } catch (error) {
      console.error(chalk.bgRed(`Gagal menetapkan leverage: ${error.message || error}`));
      return;
    }

    // Ambil data candle
    const candles = await client.futuresCandles({ symbol: SYMBOL, interval: "15m" });
    if (candles.length < 20) {
      console.warn(chalk.bgYellow("Data candle tidak mencukupi untuk analisis."));
      return;
    }

    // Hitung indikator teknikal
    const lastPrice = parseFloat(candles.at(-1).close);
    const closingPrices = candles.map((c) => parseFloat(c.close));
    const volumes = candles.map((c) => parseFloat(c.volume));
    const atr = await calculateATR(candles, 14);
    const vwap = await calculateVWAP(candles);
    const rsi = await calculateRSI(candles, 14);

    // Cek kondisi ekstrem
    if (await checkExtremeMarketConditions(atr, vwap, lastPrice, volumes)) return;

    const marketCondition = await determineMarketCondition(rsi, vwap, closingPrices, lastPrice);

    // Ambil data order & posisi
    const openOrders = await client.futuresOpenOrders({ symbol: SYMBOL });
    const positions = await client.futuresPositionRisk();
    const openPosition = positions.find((p) => parseFloat(p.positionAmt) !== 0);

    // Jika ada order terbuka
    if (openOrders.length > 0) {
      const limitBuyOrders = openOrders.filter((o) => o.side === "BUY" && o.type === "LIMIT");
      const limitSellOrders = openOrders.filter((o) => o.side === "SELL" && o.type === "LIMIT");

      const conflictOrders =
        (limitBuyOrders.length > 0 && marketCondition === "SHORT") ||
        (limitSellOrders.length > 0 && marketCondition === "LONG");

      if (conflictOrders) {
        console.log(chalk.red("Kondisi pasar bertentangan dengan limit order. Menutup semua..."));
        await closeOpenOrders();
        await closeOpenPositions();
        return;
      } else {
        console.log(chalk.green("Limit orders sesuai arah pasar."));
      }

      // Periksa posisi terbuka
      if (openPosition) {
        const positionSide = parseFloat(openPosition.positionAmt) > 0 ? "LONG" : "SHORT";

        if (
          (marketCondition === "LONG" && positionSide === "SHORT") ||
          (marketCondition === "SHORT" && positionSide === "LONG")
        ) {
          console.log(chalk.red(`Posisi ${positionSide} bertentangan dengan sinyal ${marketCondition}. Menutup posisi...`));
          await closeOpenOrders();
          await closeOpenPositions();
          return;
        } else {
          console.log(chalk.green(`Posisi ${positionSide} sejalan dengan pasar.`));
        }
      }

      await monitorOrders();
      console.log(chalk.blue(`Menunggu... (${openOrders.length} order terbuka)`));
      logPL();
      return;
    }

    // Jika tidak ada order terbuka dan ada sinyal valid
    if (marketCondition === "LONG" || marketCondition === "SHORT") {
      console.log(chalk.blue(`Sinyal ${marketCondition} terdeteksi. Menempatkan order grid.`));
      await placeGridOrders(currentPrice, atr, marketCondition);

      const direction = marketCondition === "LONG" ? "BUY" : "SELL";
      const { quantityPrecision } = await getSymbolPrecision(SYMBOL);
      const quantity = parseFloat(((BASE_USDT * LEVERAGE) / currentPrice).toFixed(quantityPrecision));

      try {
        await client.futuresOrder({
          symbol: SYMBOL,
          side: direction,
          type: "MARKET",
          quantity: quantity,
        });
        console.log(chalk.green(`Posisi ${marketCondition} dibuka: ${quantity} ${SYMBOL}.`));
      } catch (error) {
        console.error(chalk.bgRed(`Gagal membuka posisi: ${error.message || error}`));
      }
    } else {
      console.log(chalk.blue("Tidak ada sinyal baru. Menunggu..."));
    }

    logPL();
  } catch (error) {
    console.error(chalk.bgRed("Kesalahan utama dalam trading:"), error.message || error);
  }
}

// Fungsi logging P/L
function logPL() {
  const profitMsg = `Total Profit: ${totalProfit.toFixed(2)} USDT`;
  const lossMsg = `Total Loss: ${totalLoss.toFixed(2)} USDT`;
  console.log(chalk.yellow(profitMsg));
  console.log(chalk.yellow(lossMsg));
  logToFile(profitMsg);
  logToFile(lossMsg);
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
