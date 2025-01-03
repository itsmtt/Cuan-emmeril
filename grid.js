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

const SYMBOL = config.SYMBOL; // Symbol yang akan ditradingkan
const GRID_COUNT = config.GRID_COUNT; // Jumlah level grid
const LEVERAGE = config.LEVERAGE; // Leverage untuk trading
const BASE_USDT = config.BASE_USDT; // Nilai order per grid dalam USDT

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
    console.error(chalk.bgRed("Kesalahan saat menutup order terbuka:"), error);
    throw error; // Bubble up the error for higher-level handling
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

        const currentPrice = parseFloat(
          position.markPrice || position.entryPrice
        ); // Gunakan markPrice jika ada
        const entryPrice = parseFloat(position.entryPrice);
        // Hitung profit atau loss
        const pnl =
          side === "SELL"
            ? (entryPrice - currentPrice) * quantity
            : (currentPrice - entryPrice) * quantity;

        if (pnl > 0) {
          totalProfit += pnl;
          console.log(
            chalk.green(
              `Profit dari posisi pada ${position.symbol}: ${pnl.toFixed(2)}`
            )
          );
        } else {
          totalLoss += Math.abs(pnl);
          console.log(
            chalk.red(
              `Loss dari posisi pada ${position.symbol}: ${Math.abs(
                pnl
              ).toFixed(2)}`
            )
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
function fuzzyMembership(value, low, high) {
  if (value <= low) return 1; // Penuh keanggotaan
  if (value >= high) return 0; // Tidak ada keanggotaan
  return (high - value) / (high - low); // Linear
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

    const typicalPrice = (high + low + close) / 3; // Harga tipikal
    cumulativeVolume += volume;
    cumulativePriceVolume += typicalPrice * volume;
  }

  return cumulativePriceVolume / cumulativeVolume; // Rumus VWAP
}

// Fungsi untuk memeriksa kondisi pasar ekstrem
async function checkExtremeMarketConditions(candles) {
  const atr = await calculateATR(candles, 14);
  const lastPrice = parseFloat(candles[candles.length - 1].close);
  const vwap = calculateVWAP(candles);

  // Keanggotaan fuzzy untuk ATR
  const highVolatility = fuzzyMembership(atr, 0.05, 0.1); // ATR > 5% dianggap volatil
  const extremeVolatility = fuzzyMembership(atr, 0.1, 0.2); // ATR > 10% dianggap sangat volatil

  // Keanggotaan fuzzy untuk volume ekstrem
  const volumes = candles.map((c) => parseFloat(c.volume));
  const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
  const volumeMembership = fuzzyMembership(
    volumes[volumes.length - 1],
    avgVolume * 1.5,
    avgVolume * 3
  );

  // Keanggotaan fuzzy untuk harga jauh dari VWAP
  const priceFarBelowVWAP = fuzzyMembership(lastPrice, vwap * 0.8, vwap * 0.9);
  const priceFarAboveVWAP = fuzzyMembership(lastPrice, vwap * 1.1, vwap * 1.2);

  // Gabungkan aturan fuzzy
  const valuesisExtreme = [
    highVolatility,
    extremeVolatility,
    volumeMembership,
    priceFarBelowVWAP,
    priceFarAboveVWAP,
  ]; // Array nilai
  const isExtreme =
    valuesisExtreme.reduce((sum, value) => sum + value, 0) /
    valuesisExtreme.length;

  const logIsExtreme = isExtreme * 100;

  console.log(chalk.yellow(`Pasar dalam kondisi ekstrem jika nilai 90 % : ${logIsExtreme} %`));

  if (isExtreme >= 0.9) {
    // Threshold 0.9 untuk kondisi ekstrem
    console.log(
      chalk.red("Pasar dalam kondisi ekstrem. Menghentikan trading sementara.")
    );
    await closeOpenPositions(); // Menutup semua posisi terbuka
    await closeOpenOrders();
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
  const vwap = calculateVWAP(candles);

  const lastPrice = closingPrices[closingPrices.length - 1];

  // Log indikator
  // console.log(
  //   chalk.yellow(
  //     `Short EMA: ${shortEMA.toFixed(6)}, Long EMA: ${longEMA.toFixed(
  //       6
  //     )}, RSI: ${rsi.toFixed(2)}, MACD: ${macdLine.toFixed(
  //       6
  //     )}, Signal: ${signalLine.toFixed(6)}, VWAP: ${vwap.toFixed(
  //       6
  //     )}, Upper Band: ${upperBand.toFixed(6)}, Lower Band: ${lowerBand.toFixed(
  //       6
  //     )}, Closing Price: ${lastPrice.toFixed(6)}`
  //   )
  // );

  // Keanggotaan fuzzy untuk kondisi pasar
  const rsiBuy = fuzzyMembership(rsi, 30, 50); // RSI rendah (oversold)
  const rsiSell = fuzzyMembership(rsi, 50, 70); // RSI tinggi (overbought)
  const macdBuy = macdLine > signalLine ? 1 : 0; // MACD positif
  const macdSell = macdLine < signalLine ? 1 : 0; // MACD negatif
  const priceNearLowerBand = fuzzyMembership(
    lastPrice,
    lowerBand,
    lowerBand * 1.02
  ); // Dekat lower band
  const priceNearUpperBand = fuzzyMembership(
    lastPrice,
    upperBand * 0.98,
    upperBand
  ); // Dekat upper band

  // Logika berbasis VWAP
  const priceBelowVWAP = lastPrice < vwap ? 1 : 0; // Harga di bawah VWAP
  const priceAboveVWAP = lastPrice > vwap ? 1 : 0; // Harga di atas VWAP

  // Logika untuk BUY
  const valuesBuySignal = [rsiBuy, macdBuy, priceNearLowerBand, priceBelowVWAP]; // Array nilai
  const buySignal =
    valuesBuySignal.reduce((sum, value) => sum + value, 0) /
    valuesBuySignal.length;
  // Logika untuk SELL
  const valuesSellSignal = [
    rsiSell,
    macdSell,
    priceNearUpperBand,
    priceAboveVWAP,
  ]; // Array nilai
  const sellSignal =
    valuesSellSignal.reduce((sum, value) => sum + value, 0) /
    valuesSellSignal.length;

  const logBuySignal = buySignal.toFixed(2) * 100;
  const logSellSignal = sellSignal.toFixed(2) * 100;

  console.log(
    chalk.yellow(
      `Fuzzy Signals: BUY = ${logBuySignal} % Jika lebih dari 50 %, SELL = ${logSellSignal} % Jika lebih dari 50 %`
    )
  );

  // Tentukan sinyal berdasarkan nilai keanggotaan tertinggi
  if (buySignal > sellSignal && buySignal > 0.5) {
    console.log(`Posisi sekarang LONG (indikator menunjukkan peluang beli).`);
    return "LONG";
  } else if (sellSignal > buySignal && sellSignal > 0.5) {
    console.log(`Posisi sekarang SHORT (indikator menunjukkan peluang jual).`);
    return "SHORT";
  } else {
    console.log(`Posisi sekarang NEUTRAL. Menunggu.`);
    return "NEUTRAL";
  }
}

// Fungsi untuk menetapkan order grid dengan take profit dan stop loss
async function placeGridOrders(currentPrice, atr, direction) {
  // Pastikan semua posisi dan order terbuka ditutup sebelum membuat order baru
  await closeOpenPositions();
  await closeOpenOrders();

  const { pricePrecision, quantityPrecision } = await getSymbolPrecision(
    SYMBOL
  );

  // Ambil tickSize dari Binance API
  const exchangeInfo = await client.futuresExchangeInfo();
  const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === SYMBOL);
  if (!symbolInfo) {
    console.error(`Symbol ${SYMBOL} tidak ditemukan di Binance.`);
    return;
  }
  const tickSize = parseFloat(
    symbolInfo.filters.find((f) => f.tickSize).tickSize
  );

  // Hitung VWAP dari data candle
  const candles = await client.futuresCandles({
    symbol: SYMBOL,
    interval: "15m",
    limit: 50,
  });
  const vwap = calculateVWAP(candles);

  const buffer = (atr * 0.5) + (Math.abs(currentPrice - vwap) * 0.5);

  // Gunakan fuzzy logic untuk menyesuaikan level grid
  const volatility = atr / currentPrice; // Volatilitas relatif
  const gridCount = volatility > 0.03 ? GRID_COUNT - 2 : GRID_COUNT; // Fuzzy: lebih sedikit grid jika volatilitas tinggi
  const gridSpacing = volatility > 0.03 ? atr * 1.5 : atr; // Fuzzy: jarak lebih lebar jika volatilitas tinggi

  console.log(
    chalk.yellow(
      `VWAP: ${vwap.toFixed(6)}, Volatility: ${volatility.toFixed(
        6
      )}, Grid Count: ${gridCount}, Grid Spacing: ${gridSpacing.toFixed(6)}`
    )
  );

  const existingOrders = await client.futuresOpenOrders({ symbol: SYMBOL });

  for (let i = 1; i <= gridCount; i++) {
    // Hitung harga grid
    const price =
      direction === "LONG"
        ? Math.max(currentPrice - gridSpacing * i - buffer, vwap - atr * i)
        : Math.min(currentPrice + gridSpacing * i + buffer, vwap + atr * i);

    // Validasi apakah harga grid logis
    const isPriceValid =
      price > currentPrice * 0.8 && price < currentPrice * 1.2; // Kisaran 20% dari harga sekarang
    if (!isPriceValid) {
      console.warn(`Harga grid ${price} tidak logis, melewati iterasi.`);
      continue;
    }

    // Hitung kuantitas dan pembulatan harga/kuantitas
    const quantity = (BASE_USDT * LEVERAGE) / currentPrice;
    const roundedPrice = parseFloat(
      (Math.round(price / tickSize) * tickSize).toFixed(pricePrecision)
    );
    const roundedQuantity = parseFloat(quantity.toFixed(quantityPrecision));

    // Validasi notional value
    const notional = roundedPrice * roundedQuantity;
    if (notional < 5) {
      console.error(
        `Notional value terlalu kecil: ${notional.toFixed(
          2
        )} (minimal 5). Melewati order.`
      );
      continue;
    }

    const duplicateOrder = existingOrders.some(
      (order) =>
        parseFloat(order.price).toFixed(pricePrecision) ===
        roundedPrice.toFixed(pricePrecision)
    );

    if (duplicateOrder) {
      console.log(
        chalk.yellow(
          `Order di harga ${roundedPrice} sudah ada. Melewati iterasi.`
        )
      );
      continue;
    }

    try {
      // Tempatkan Order Grid
      await client.futuresOrder({
        symbol: SYMBOL,
        side: direction === "LONG" ? "BUY" : "SELL",
        type: "LIMIT",
        price: roundedPrice,
        quantity: roundedQuantity,
        timeInForce: "GTC",
      });
      console.log(
        chalk.green(
          `Order grid berhasil ditempatkan di harga ${roundedPrice}, kuantitas ${roundedQuantity}, arah ${direction}`
        )
      );

      // Hitung takeProfitPrice menggunakan fuzzy logic dan VWAP
      const priceBelowVWAP = fuzzyMembership(currentPrice, vwap * 0.95, vwap);
      const priceAboveVWAP = fuzzyMembership(currentPrice, vwap, vwap * 1.05);
      const fuzzyMultiplier = priceBelowVWAP > priceAboveVWAP ? 1.5 : 1; // Tambahkan bobot jika harga di bawah VWAP

      const takeProfitPrice =
        direction === "LONG"
          ? roundedPrice + fuzzyMultiplier * atr + buffer
          : roundedPrice - fuzzyMultiplier * atr - buffer;
      const roundedTakeProfitPrice = parseFloat(
        (Math.round(takeProfitPrice / tickSize) * tickSize).toFixed(
          pricePrecision
        )
      );

      const stopLossPrice =
        direction === "LONG"
          ? roundedPrice - fuzzyMultiplier * atr - buffer
          : roundedPrice + fuzzyMultiplier * atr + buffer;
      const roundedStopLossPrice = parseFloat(
        (Math.round(stopLossPrice / tickSize) * tickSize).toFixed(
          pricePrecision
        )
      );

      const existingOrders = await client.futuresOpenOrders({ symbol: SYMBOL });
      const duplicateTP = existingOrders.some(
        (order) =>
          order.type === "TAKE_PROFIT_MARKET" &&
          parseFloat(order.stopPrice).toFixed(pricePrecision) ===
            roundedTakeProfitPrice.toFixed(pricePrecision)
      );
      const duplicateSL = existingOrders.some(
        (order) =>
          order.type === "STOP_MARKET" &&
          parseFloat(order.stopPrice).toFixed(pricePrecision) ===
            roundedStopLossPrice.toFixed(pricePrecision)
      );

      if (!duplicateTP) {
        await client.futuresOrder({
          symbol: SYMBOL,
          side: direction === "LONG" ? "SELL" : "BUY",
          type: "TAKE_PROFIT_MARKET",
          stopPrice: roundedTakeProfitPrice,
          quantity: roundedQuantity,
          timeInForce: "GTC",
          reduceOnly: true,
        });
        console.log(
          chalk.green(
            `Take Profit di harga ${roundedTakeProfitPrice} berhasil dibuat.`
          )
        );
      } else {
        console.log(
          chalk.yellow(
            `Take Profit di harga ${roundedTakeProfitPrice} sudah ada.`
          )
        );
      }

      if (!duplicateSL) {
        await client.futuresOrder({
          symbol: SYMBOL,
          side: direction === "LONG" ? "SELL" : "BUY",
          type: "STOP_MARKET",
          stopPrice: roundedStopLossPrice,
          quantity: roundedQuantity,
          timeInForce: "GTC",
          reduceOnly: true,
        });
        console.log(
          chalk.green(
            `Stop Loss di harga ${roundedStopLossPrice} berhasil dibuat.`
          )
        );
      } else {
        console.log(
          chalk.yellow(`Stop Loss di harga ${roundedStopLossPrice} sudah ada.`)
        );
      }
    } catch (error) {
      console.error(
        `Kesalahan saat menempatkan order grid atau Take Profit: ${error.message}`
      );
    }
  }
}

// memantau kondisi Take profit
// Fungsi untuk memantau status order terbuka dan mengambil tindakan
async function monitorOrders() {
  try {
    console.log(chalk.blue("Memeriksa status order terbuka..."));

    // Ambil semua order terbuka
    const openOrders = await client.futuresOpenOrders({ symbol: SYMBOL });

    // Periksa apakah ada order dengan status FILLED
    const allOrders = await client.futuresAllOrders({ symbol: SYMBOL });

    const takeProfitOrder = allOrders.find(
      (order) =>
        order.type === "TAKE_PROFIT_MARKET" && order.status === "FILLED"
    );

    const stopLossOrder = allOrders.find(
      (order) => order.type === "STOP_MARKET" && order.status === "FILLED"
    );

    if (takeProfitOrder || stopLossOrder) {
      console.log(
        chalk.green(
          `Order ${takeProfitOrder ? "Take Profit" : "Stop Loss"} tercapai.`
        )
      );
      console.log(chalk.blue("Menutup semua posisi dan order..."));
      await closeOpenPositions();
      await closeOpenOrders();
    } else if (openOrders.length > 0) {
      console.log(
        chalk.blue(
          `Take Profit dan Stop Loss masih belum tercapai. Memantau kembali...`
        )
      );
    } else {
      console.log(
        chalk.blue(
          "Tidak ada order terbuka dan posisi terbuka yang membutuhkan tindakan saat ini."
        )
      );
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

    const currentPrice = parseFloat(ticker[SYMBOL]);
    console.log(
      chalk.yellow(
        `Harga pasar terkini untuk ${SYMBOL}: ${currentPrice.toFixed(6)}`
      )
    );

    // Periksa apakah masih ada order terbuka
    const openOrders = await client.futuresOpenOrders({ symbol: SYMBOL });
    if (openOrders.length > 0) {
      // Mengambil data candle
      const candles = await client.futuresCandles({
        symbol: SYMBOL,
        interval: "15m",
        limit: 50,
      });

      if (await checkExtremeMarketConditions(candles)) {
        return; // Berhenti jika pasar terlalu ekstrem
      }
      await monitorOrders(); // Memantau status take profit
      console.log(
        chalk.blue(`Masih ada ${openOrders.length} order terbuka. Menunggu...`)
      );
      return; // Keluar dari fungsi jika masih ada order terbuka
    }

    // Periksa apakah masih ada posisi terbuka
    const positions = await client.futuresPositionRisk();
    const openPosition = positions.find(
      (position) => parseFloat(position.positionAmt) !== 0
    );
    if (openPosition) {
      // Mengambil data candle
      const candles = await client.futuresCandles({
        symbol: SYMBOL,
        interval: "15m",
        limit: 50,
      });

      if (await checkExtremeMarketConditions(candles)) {
        return; // Berhenti jika pasar terlalu ekstrem
      }
      await monitorOrders(); // Memantau status take profit
      console.log(
        chalk.blue(
          `Masih ada posisi terbuka pada ${openPosition.symbol}. Menunggu...`
        )
      );
      return; // Keluar dari fungsi jika masih ada posisi terbuka
    }

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

    // Tempatkan order grid jika ada sinyal trading
    if (marketCondition === "LONG" || marketCondition === "SHORT") {
      console.log(
        chalk.blue(
          `Sinyal order baru terdeteksi: ${marketCondition}. Menempatkan order grid.`
        )
      );
      await placeGridOrders(currentPrice, atr, marketCondition);
    } else {
      console.log(chalk.blue("Tidak ada sinyal order baru, menunggu..."));
    }

    // Log total profit dan loss saat ini
    console.log(chalk.yellow(`Total Profit: ${totalProfit.toFixed(2)} USDT`));
    console.log(chalk.yellow(`Total Loss: ${totalLoss.toFixed(2)} USDT`));
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
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Jeda 10 detik
  }
}

// Memulai bot
runBot();
