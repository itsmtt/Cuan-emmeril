const fs = require("fs");
const winston = require("winston");

// Configure logging
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "trading_bot.log" }),
  ],
});

function logToFile(message) {
  const logMessage = `${new Date().toISOString()} - ${message}\n`;
  fs.appendFileSync("profit_loss_logs.txt", logMessage, (err) => {
    if (err) {
      logger.error("Gagal mencatat ke file log:", err.message);
    }
  });
}

async function getSymbolPrecision(client, symbol) {
  try {
    const exchangeInfo = await client.futuresExchangeInfo();
    const symbolInfo = exchangeInfo.symbols.find((s) => s.symbol === symbol);
    if (!symbolInfo) throw new Error(`Symbol ${symbol} tidak ditemukan.`);
    const pricePrecision = symbolInfo.pricePrecision;
    const quantityPrecision = symbolInfo.quantityPrecision;
    return { pricePrecision, quantityPrecision };
  } catch (error) {
    logger.error("Kesalahan saat mendapatkan presisi pasangan perdagangan:", error.message || error);
    throw error;
  }
}

function calculateFuzzySignals(signals) {
  return signals.reduce((sum, value) => sum + value, 0) / signals.length;
}

module.exports = {
  logToFile,
  getSymbolPrecision,
  calculateFuzzySignals,
};
