const Binance = require('binance-api-node').default;
const chalk = require('chalk'); // Untuk memberikan warna pada output

// Konfigurasi API key dan secret Anda
const client = Binance({
  apiKey: 'XmRkrzNO7gFvUjB16WfHTBUs04T2UpXdN37UDfWPriMVoSQ9hUqnuPVAOUMR5p7Q',
  apiSecret: 's1bzfjvCWXZQa2w8VL3VgkoXUcTd64ygXzjLsvnWYckxvsRF7ryX2YyQFOfqe63E',
});

// Parameter trading
const SYMBOL = 'XRPUSDT'; // Symbol yang akan ditradingkan
const ORDER_AMOUNT_USDT = 2; // Jumlah USDT yang akan digunakan untuk order
const LEVERAGE = 5; // Leverage untuk trading futures
const SHORT_EMA_PERIOD = 9; // Periode EMA pendek
const LONG_EMA_PERIOD = 21; // Periode EMA panjang

let totalProfit = 0;
let totalLoss = 0;
let reconnectAttempts = 0;
let activeOrder = null; // Menyimpan informasi order yang sedang aktif

function getCurrentTimeInJakarta() {
    const now = new Date();
    const jakartaOffset = 7 * 60; // Waktu Indonesia Barat (WIB) adalah UTC+7
    const localTime = new Date(now.getTime() + jakartaOffset * 60 * 1000);
    return localTime;
}

function shouldStopApplication() {
    //  const currentTime = getCurrentTimeInJakarta();
    // return currentTime.getHours() === 7;
    return false;
}

async function calculateEMA(data, period) {
    const k = 2 / (period + 1);
    let ema = data[0]; // EMA pertama diinisialisasi ke harga pertama

    for (let i = 1; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return ema;
}

async function closeOpenOrders() {
    try {
        const positions = await client.futuresPositionRisk();
        const openPosition = positions.find(position => parseFloat(position.positionAmt) !== 0 && position.symbol === SYMBOL);

        if (openPosition) {
            console.log(chalk.yellow(`Order terbuka terdeteksi pada ${SYMBOL}. Menutup order...`));

            const side = parseFloat(openPosition.positionAmt) > 0 ? 'SELL': 'BUY';
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

async function stopApplication() {
    if (activeOrder) {
        console.log(chalk.yellow('Menutup order aktif sebelum menghentikan aplikasi...'));

        try {
            const side = activeOrder.side === 'BUY' ? 'SELL': 'BUY';
            await client.futuresOrder({
                symbol: SYMBOL,
                side: side,
                type: 'MARKET',
                quantity: activeOrder.quantity.toFixed(6),
            });

            console.log(chalk.green('Order aktif berhasil ditutup.'));
        } catch (error) {
            console.error(chalk.bgRed('Gagal menutup order aktif:'), error);
        }
    }

    console.log(chalk.bgBlue('Aplikasi dihentikan pada pukul 7 pagi WIB.'));
    process.exit(0);
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
            if (shouldStopApplication()) {
                await stopApplication();
            }

            try {
                // Ambil data candlestick
                const candles = await client.futuresCandles({
                    symbol: SYMBOL,
                    interval: '1m',
                    limit: Math.max(SHORT_EMA_PERIOD, LONG_EMA_PERIOD) + 1,
                });
                const closingPrices = candles.map(c => parseFloat(c.close));

                // Hitung EMA pendek dan panjang
                const shortEMA = await calculateEMA(closingPrices.slice(-SHORT_EMA_PERIOD - 1), SHORT_EMA_PERIOD);
                const longEMA = await calculateEMA(closingPrices.slice(-LONG_EMA_PERIOD - 1), LONG_EMA_PERIOD);

                console.log(`Short EMA: ${shortEMA}, Long EMA: ${longEMA}`);

                // Tentukan sinyal entry
                if (shortEMA > longEMA) {
                    console.log(chalk.green('Sinyal BUY terdeteksi'));

                    // Hitung kuantitas berdasarkan order amount dan leverage
                    const ticker = await client.futuresPrices();
                    const lastPrice = parseFloat(ticker[SYMBOL]);
                    let quantity = (ORDER_AMOUNT_USDT * LEVERAGE) / lastPrice;

                    // Sesuaikan kuantitas dengan step size
                    quantity = Math.floor(quantity / stepSize) * stepSize;

                    // Buat order market buy
                    const buyOrder = await client.futuresOrder({
                        symbol: SYMBOL,
                        side: 'BUY',
                        type: 'MARKET',
                        quantity: quantity.toFixed(6),
                    });

                    console.log(chalk.green('Order beli berhasil:'), buyOrder);

                    activeOrder = {
                        side: 'BUY',
                        price: lastPrice,
                        quantity,
                        timestamp: Date.now()
                    };

                    // Tunggu sampai take profit atau stop loss
                    await monitorOrder(quantity, 'BUY');
                } else if (shortEMA < longEMA) {
                    console.log(chalk.red('Sinyal SELL terdeteksi'));

                    // Hitung kuantitas berdasarkan order amount dan leverage
                    const ticker = await client.futuresPrices();
                    const lastPrice = parseFloat(ticker[SYMBOL]);
                    let quantity = (ORDER_AMOUNT_USDT * LEVERAGE) / lastPrice;

                    // Sesuaikan kuantitas dengan step size
                    quantity = Math.floor(quantity / stepSize) * stepSize;

                    // Buat order market sell
                    const sellOrder = await client.futuresOrder({
                        symbol: SYMBOL,
                        side: 'SELL',
                        type: 'MARKET',
                        quantity: quantity.toFixed(6),
                    });

                    console.log(chalk.red('Order jual berhasil:'), sellOrder);

                    activeOrder = {
                        side: 'SELL',
                        price: lastPrice,
                        quantity,
                        timestamp: Date.now()
                    };

                    // Tunggu sampai take profit atau stop loss
                    await monitorOrder(quantity, 'SELL');
                } else {
                    console.log('Tidak ada sinyal trading saat ini.');
                }

                // Reset reconnect attempts jika berhasil berjalan
                reconnectAttempts = 0;

            } catch (error) {
                console.error(chalk.bgRed('Kesalahan saat trading:'), error);
                await handleConnectionError();
            }

            // Tunggu beberapa waktu sebelum iterasi berikutnya
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    } catch (error) {
        console.error(chalk.bgRed('Terjadi kesalahan utama:'), error);
    }
}

async function monitorOrder(quantity, side) {
    const PROFIT_ROI = 10; // ROI target profit 10%
    const LOSS_ROI = 5; // ROI stop loss 20%

    const entryPrice = activeOrder.price;

    while (true) {
        try {
            const ticker = await client.futuresPrices();
            const currentPrice = parseFloat(ticker[SYMBOL]);

            const roi = side === 'BUY'
            ? ((currentPrice - entryPrice) / entryPrice) * LEVERAGE * 100: ((entryPrice - currentPrice) / entryPrice) * LEVERAGE * 100;

            console.log(`ROI saat ini: ${roi.toFixed(2)}%`);

            if (roi >= PROFIT_ROI) {
                const profit = ((roi / 100) * entryPrice * quantity * LEVERAGE);
                totalProfit += profit;
                console.log(chalk.bgGreen(`Take profit tercapai. ROI: ${roi.toFixed(2)}%, Profit: ${profit.toFixed(2)} USDT`));
                console.log(chalk.green(`Total Profit: ${totalProfit.toFixed(2)} USDT, Total Loss: ${totalLoss.toFixed(2)} USDT`));

                // Buat order untuk menutup posisi
                await client.futuresOrder({
                    symbol: SYMBOL,
                    side: side === 'BUY' ? 'SELL': 'BUY',
                    type: 'MARKET',
                    quantity: quantity.toFixed(6),
                });

                activeOrder = null;
                break;
            } else if (roi <= -LOSS_ROI) {
                const loss = Math.abs((roi / 100) * entryPrice * quantity * LEVERAGE);
                totalLoss += loss;
                console.log(chalk.bgRed(`Stop loss tercapai. ROI: ${roi.toFixed(2)}%, Loss: ${loss.toFixed(2)} USDT`));
                console.log(chalk.green(`Total Profit: ${totalProfit.toFixed(2)} USDT, Total Loss: ${totalLoss.toFixed(2)} USDT`));

                // Buat order untuk menutup posisi
                await client.futuresOrder({
                    symbol: SYMBOL,
                    side: side === 'BUY' ? 'SELL': 'BUY',
                    type: 'MARKET',
                    quantity: quantity.toFixed(6),
                });

                activeOrder = null;
                break;
            }

            if (shouldStopApplication()) {
                await stopApplication();
            }

            // Tunggu sebelum cek harga lagi
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            console.error(chalk.bgRed('Kesalahan saat memonitor order:'), error);
            await handleConnectionError();
        }
    }
}

async function handleConnectionError() {
    reconnectAttempts++;
    console.log(chalk.yellow(`Percobaan koneksi ulang ke-${reconnectAttempts}...`));

    if (reconnectAttempts > 5) {
        console.error(chalk.bgRed('Gagal terkoneksi setelah beberapa percobaan. Menghentikan aplikasi.'));
        process.exit(1);
    }

    // Tunggu sebelum mencoba ulang
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Uji ulang koneksi dengan permintaan sederhana
    try {
        await client.time();
        console.log(chalk.green('Koneksi berhasil dipulihkan.'));

        if (activeOrder) {
            console.log(chalk.blue('Memeriksa kondisi order aktif setelah koneksi pulih...'));

            const ticker = await client.futuresPrices();
            const currentPrice = parseFloat(ticker[SYMBOL]);

            const roi = activeOrder.side === 'BUY'
            ? ((currentPrice - activeOrder.price) / activeOrder.price) * LEVERAGE * 100: ((activeOrder.price - currentPrice) / activeOrder.price) * LEVERAGE * 100;

            if (roi <= -LOSS_ROI) {
                console.log(chalk.bgRed('Harga melebihi batas stop loss setelah koneksi pulih. Menutup order.'));

                await client.futuresOrder({
                    symbol: SYMBOL,
                    side: activeOrder.side === 'BUY' ? 'SELL': 'BUY',
                    type: 'MARKET',
                    quantity: activeOrder.quantity.toFixed(6),
                });

                activeOrder = null;
            } else {
                console.log(chalk.green('Order tetap dalam batas aman. Melanjutkan trading.'));
            }
        }

        reconnectAttempts = 0; // Reset setelah koneksi berhasil
    } catch (error) {
        console.error(chalk.bgRed('Koneksi masih gagal, mencoba lagi...'));
        await handleConnectionError();
    }
}

trade();
