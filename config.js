module.exports = {
  // إعدادات البوت
  bot: {
    token: process.env.BOT_TOKEN || '8275181418:AAHRGLNjc6JxI2wiboqDJFpw3HEvCugn4fA',
    adminId: process.env.ADMIN_CHAT_ID || '7604667042',
    pollInterval: 3000
  },

  // إعدادات الخادم
  server: {
    port: process.env.PORT || 3000,
    host: '0.0.0.0',
    rateLimit: {
      points: 10,
      duration: 1
    }
  },

  // إعدادات الأمان
  security: {
    allowedFileTypes: [
      'image/jpeg',
      'image/png', 
      'image/gif',
      'video/mp4',
      'audio/mpeg',
      'text/plain',
      'application/pdf'
    ],
    maxFileSize: 10 * 1024 * 1024, // 10MB
    sessionTimeout: 30 * 60 * 1000 // 30 دقيقة
  },

  // الرسائل
  messages: {
    welcome: "🎯 مرحباً بك في نظام التحكم المتقدم",
    deviceConnected: "🟢 جهاز جديد متصل",
    deviceDisconnected: "🔴 جهاز منفصل",
    error: "❌ حدث خطأ، الرجاء المحاولة لاحقاً"
  }
};