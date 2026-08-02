#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  install.sh — تثبيت المشروع على Termux بضغطة واحدة
#  الاستخدام:  bash install.sh
# ============================================================
set -e
echo "╔════════════════════════════════════════════╗"
echo "║  🤖 تثبيت Job AI — بوت عروض العمل واتساب   ║"
echo "╚════════════════════════════════════════════╝"

echo "📦 [1/3] تحديث الحزم وتثبيت Node.js..."
pkg update -y && pkg install -y nodejs-lts git

echo "📦 [2/3] تثبيت مكتبات المشروع..."
npm install --no-audit --no-fund

echo "📦 [3/3] تجهيز مجلد البيانات..."
mkdir -p data

# اختياري: تثبيت Chromium لاستخراج أنابيك (الموقع يعمل بـ Angular)
read -p "❓ هل تريد تثبيت Chromium لدعم موقع أنابيك؟ (y/n): " ans
if [ "$ans" = "y" ]; then
  pkg install -y tur-repo 2>/dev/null || true
  pkg install -y chromium 2>/dev/null && echo "✅ تم تثبيت Chromium" || echo "⚠️ تعذر تثبيت Chromium — يمكنك تثبيته لاحقاً: pkg install tur-repo && pkg install chromium"
fi

echo ""
echo "✅ اكتمل التثبيت!"
echo "🚀 للتشغيل:  bash start.sh   أو   npm start"
echo "🖥️  لوحة التحكم:  http://localhost:3000"
