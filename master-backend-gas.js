/**
 * ==============================================================================
 * KEUANGANKU PRO - MASTER LICENSE & DEVELOPER BACKEND (v2.3)
 * Sambarang Production - Developer Licensing & Anti-Piracy Server
 * ==============================================================================
 * 
 * ATURAN BISNIS & ALUR LISENSI:
 * 1. Setiap order dari website mendapatkan 1 Token unik sekali pakai (misal: PRO-8A2F-9D41).
 * 2. Token ini berfungsi sebagai PIN/Password awal (default) untuk membuka aplikasi.
 * 3. KONDISI MASIH TOKEN BAWAAN:
 *    - Token HANYA BISA aktif di 1 perangkat saja.
 *    - Fitur Sinkronisasi Cloud di aplikasi TERKUNCI.
 *    - Token dilarang dipakai di perangkat ke-2 sebelum PIN diganti.
 * 4. KONDISI SETELAH PENGGUNA GANTI PIN PRIBADI:
 *    - Token bawaan HANGUS (tidak bisa dipakai lagi oleh orang lain secara mentah).
 *    - Pengguna dapat menghubungkan perangkat ke-2 (Laptop/HP kedua) menggunakan PIN Pribadinya.
 *    - Fitur Sinkronisasi Cloud TERBUKA.
 * 5. DEVELOPER DASHBOARD:
 *    - Menampilkan informasi apakah pembeli sudah ganti PIN (Token Hangus) atau masih pakai token bawaan.
 *    - Menampilkan jumlah perangkat terhubung per pembeli.
 *    - Developer bisa mengaktifkan/mereset kembali token jika pembeli meminta bantuan.
 * ==============================================================================
 */

// Kata sandi admin HANYA dibaca dari Script Properties (DEV_PORTAL_PASSWORD), tidak ada lagi
// kata sandi bawaan di file publik ini. Jika belum diatur, semua aksi admin DITOLAK.
// Cara mengatur: Apps Script > Setelan Project (ikon roda gigi) > Properti skrip >
// Tambahkan properti "DEV_PORTAL_PASSWORD" berisi kata sandi panjang & unik.
// Kata sandi bawaan lama ini hanya disimpan untuk ditolak bila dipakai lagi.
var LEGACY_DEFAULT_ADMIN_PASSWORD = "adminKeuanganku2026!";

// Token & email pemilik (developer). Bisa ditimpa lewat Script Properties:
//   OWNER_TOKENS = "PRO-XXXX-XXXX-XXXX,PRO-YYYY-YYYY-YYYY"
//   OWNER_EMAILS = "email1@gmail.com,email2@gmail.com"
// Hanya pencocokan PERSIS yang dipakai (bukan potongan nama/email).
var DEFAULT_OWNER_TOKENS = "PRO-S8GF-HQT5-CNVE,PRO-G82P-4QTS-C6RT,PRO-W9J2-RAYM-3KKL";
var DEFAULT_OWNER_EMAILS = "sambaranofficial@gmail.com,sambarang.pro@gmail.com";
var DEMO_TOKEN = "PRO-DEMO-IKLAN-2026";

function getListProperty_(name, fallback) {
  var raw = "";
  try { raw = PropertiesService.getScriptProperties().getProperty(name) || ""; } catch(e) {}
  if (!raw) raw = fallback || "";
  return raw.split(",").map(function(s) { return String(s).trim(); }).filter(function(s) { return !!s; });
}

function normalizeToken_(tok) {
  return String(tok || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Token milik developer (bebas kunci email & kuota 10 perangkat). Tidak termasuk token demo publik. */
function isOwnerToken_(tok) {
  var n = normalizeToken_(tok);
  if (!n) return false;
  return getListProperty_("OWNER_TOKENS", DEFAULT_OWNER_TOKENS).some(function(t) { return normalizeToken_(t) === n; });
}

/** Token yang mendapat kuota perangkat besar (pemilik + akun demo iklan). */
function hasPriorityQuota_(tok) {
  return isOwnerToken_(tok) || normalizeToken_(tok) === normalizeToken_(DEMO_TOKEN);
}

function isOwnerEmail_(email) {
  var e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return getListProperty_("OWNER_EMAILS", DEFAULT_OWNER_EMAILS).some(function(x) { return x.toLowerCase() === e; });
}

function tokensMatch_(a, b) {
  var na = normalizeToken_(a), nb = normalizeToken_(b);
  return !!na && na === nb;
}

/** Cegah "formula injection": teks dari pengguna yang diawali = + - @ disimpan sebagai teks biasa. */
function safeCell_(v) {
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}
function safeRow_(arr) {
  return arr.map(safeCell_);
}

// ---------- Pembatas percobaan (anti tebak PIN / password) ----------
function rlKey_(kind, id) {
  return "RL_" + kind + "_" + String(id || "-").replace(/[^A-Za-z0-9]/g, "").substring(0, 80);
}
function isRateLimited_(kind, id, max) {
  try {
    var c = CacheService.getScriptCache().get(rlKey_(kind, id));
    return !!c && parseInt(c, 10) >= max;
  } catch(e) { return false; }
}
function registerFailure_(kind, id, windowSec) {
  try {
    var cache = CacheService.getScriptCache();
    var k = rlKey_(kind, id);
    var n = parseInt(cache.get(k) || "0", 10) + 1;
    cache.put(k, String(n), windowSec || 900);
    return n;
  } catch(e) { return 0; }
}
function clearFailures_(kind, id) {
  try { CacheService.getScriptCache().remove(rlKey_(kind, id)); } catch(e) {}
}

/**
 * Verifikasi akun Google di sisi server: email diambil langsung dari Google
 * menggunakan access token milik pengguna, BUKAN dari email yang dikirim aplikasi.
 * Mengembalikan email (huruf kecil) atau "" jika gagal.
 */
// Alasan singkat kegagalan verifikasi Google terakhir (dikirim ke aplikasi untuk diagnosa; tanpa data rahasia)
var LAST_GOOGLE_VERIFY_DIAG = "";

function getVerifiedGoogleEmail_(accessToken) {
  var diag = [];
  var tok = String(accessToken || "").trim();
  if (!tok) { LAST_GOOGLE_VERIFY_DIAG = "notoken"; return ""; }
  if (tok.length > 4096) { LAST_GOOGLE_VERIFY_DIAG = "toolong"; return ""; }
  // Opsional: isi Script Property GOOGLE_CLIENT_ID agar hanya token dari aplikasi ini yang diterima
  var expectedClientId = "";
  try { expectedClientId = PropertiesService.getScriptProperties().getProperty("GOOGLE_CLIENT_ID") || ""; } catch(e) {}

  try {
    var resp = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(tok), {
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    diag.push("TI:" + code);
    if (code === 200) {
      var info = JSON.parse(resp.getContentText());
      var verified = (info.email_verified === true || info.email_verified === "true");
      var audOk = !expectedClientId || info.aud === expectedClientId || info.azp === expectedClientId;
      if (info && info.email && verified && audOk) {
        LAST_GOOGLE_VERIFY_DIAG = diag.join(" ");
        return String(info.email).trim().toLowerCase();
      }
      diag.push(!info.email ? "TI:noemail" : (!verified ? "TI:unverified" : "TI:aud"));
      if (!audOk) { LAST_GOOGLE_VERIFY_DIAG = diag.join(" "); return ""; }
    }
  } catch(e) {
    diag.push("TI:ex:" + String(e && e.message || e).substring(0, 80));
  }

  // Cadangan: endpoint userinfo (jika tokeninfo sedang bermasalah)
  if (expectedClientId) { LAST_GOOGLE_VERIFY_DIAG = diag.join(" "); return ""; }
  try {
    var resp2 = UrlFetchApp.fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { "Authorization": "Bearer " + tok },
      muteHttpExceptions: true
    });
    var code2 = resp2.getResponseCode();
    diag.push("UI:" + code2);
    if (code2 === 200) {
      var info2 = JSON.parse(resp2.getContentText());
      if (info2 && info2.email && (info2.email_verified === true || info2.email_verified === "true")) {
        LAST_GOOGLE_VERIFY_DIAG = diag.join(" ");
        return String(info2.email).trim().toLowerCase();
      }
      diag.push(!info2.email ? "UI:noemail" : "UI:unverified");
    }
  } catch(e2) {
    diag.push("UI:ex:" + String(e2 && e2.message || e2).substring(0, 80));
  }
  LAST_GOOGLE_VERIFY_DIAG = diag.join(" ");
  return "";
}

/**
 * JALANKAN SEKALI DI EDITOR APPS SCRIPT (pilih fungsi ini di menu atas lalu klik "Jalankan").
 * Memicu jendela izin Google agar server boleh menghubungi Google untuk memeriksa akun pengguna
 * (diperlukan untuk "Masuk dengan Google"). Aman dijalankan berulang kali.
 */
function izinkanAksesInternet() {
  var resp = UrlFetchApp.fetch("https://oauth2.googleapis.com/tokeninfo?access_token=cek-izin", { muteHttpExceptions: true });
  Logger.log("✅ Server sudah boleh menghubungi Google (kode uji: " + resp.getResponseCode() + ", 400 = normal).");
  return "BERHASIL: izin akses internet aktif. Sekarang Terapkan > Kelola penerapan > Versi baru.";
}

/** Cari baris token & cek apakah deviceId sudah terdaftar di lisensi tersebut. */
function findTokenRow_(data, colMap, tokenInput) {
  for (var i = 1; i < data.length; i++) {
    if (tokensMatch_(data[i][colMap.token], tokenInput)) return i;
  }
  return -1;
}
/**
 * Boleh mengganti URL Cloud tersimpan? Hanya alamat Google Apps Script resmi yang diterima,
 * Kunci (?k=...) tidak pernah ikut disimpan (lihat stripCloudKey_).
 */
function shouldReplaceCloudUrl_(currentUrl, newUrl) {
  var cur = stripCloudKey_(currentUrl);
  var nu = stripCloudKey_(newUrl);
  if (!nu || nu === cur) return false;
  if (nu.indexOf("https://script.google.com/") !== 0) return false;
  return true;
}

/**
 * PRIVASI: server lisensi TIDAK menyimpan kunci sinkronisasi Cloud Script pengguna (?k=...).
 * Hanya alamat dasarnya yang disimpan, sehingga pengelola server tidak bisa membuka data keuangan pengguna.
 * Kunci berpindah antar-perangkat lewat Scan QR (transit sementara) atau Google Drive milik pengguna.
 */
function stripCloudKey_(url) {
  var u = String(url == null ? "" : url).trim();
  if (!u) return "";
  return u.replace(/([?&])k=[^&#]*&?/g, "$1").replace(/[?&]$/, "");
}

/** Sekali jalan: hapus kunci yang dulu sempat tersimpan di kolom Cloud URL sheet Tokens. */
function purgeStoredCloudKeys_() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty("CLOUD_KEYS_PURGED") === "1") return;
    var ss = getSpreadsheet();
    var sheet = ss ? ss.getSheetByName(SHEET_TOKENS) : null;
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data && data.length > 1) {
      var colMap = getTokenColumnIndexes(data[0]);
      for (var i = 1; i < data.length; i++) {
        var raw = String(data[i][colMap.cloudUrl] || "");
        if (/[?&]k=/.test(raw)) {
          sheet.getRange(i + 1, colMap.cloudUrl + 1).setValue(stripCloudKey_(raw));
        }
      }
    }
    props.setProperty("CLOUD_KEYS_PURGED", "1");
  } catch(e) {}
}

// ------------------------------------------------------------------------------
// PIN PRIBADI DISIMPAN TERACAK (HASH), BUKAN TEKS POLOS
// Format kolom PIN di sheet Tokens: "h1$<garam>$<sidik>". PIN lama yang masih polos
// tetap bisa dipakai login dan otomatis diacak sekali jalan (hashStoredPins_).
// ------------------------------------------------------------------------------
var PIN_HASH_PREFIX = "h1$";
var PIN_HASH_ROUNDS = 50;

function normalizePinForHash_(pin) {
  var p = String(pin == null ? "" : pin).trim();
  // Google Sheets dulu kadang membuang angka 0 di depan PIN angka, jadi 0 di depan diabaikan
  if (/^\d+$/.test(p)) p = p.replace(/^0+/, "");
  return p;
}
function isPinHash_(s) {
  return String(s == null ? "" : s).trim().indexOf(PIN_HASH_PREFIX) === 0;
}
function pinDigest_(salt, pin) {
  var v = salt + ":" + normalizePinForHash_(pin);
  var bytes = null;
  for (var r = 0; r < PIN_HASH_ROUNDS; r++) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, r === 0 ? v : Utilities.base64Encode(bytes) + v, Utilities.Charset.UTF_8);
  }
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, "");
}
function hashPin_(pin) {
  var salt = Utilities.getUuid().replace(/-/g, "").slice(0, 16);
  return PIN_HASH_PREFIX + salt + "$" + pinDigest_(salt, pin);
}
/** Apakah kolom PIN berisi PIN pribadi yang sah (teracak, atau PIN polos lama). */
function hasStoredPin_(s) {
  s = String(s == null ? "" : s).trim();
  if (!s) return false;
  if (isPinHash_(s)) return true;
  return s.length <= 20 && s.indexOf("GMT") === -1;
}

/** Bandingkan PIN ketikan (a) dengan PIN tersimpan (b; teracak atau polos lama). */
function pinEquals_(a, b) {
  a = String(a == null ? "" : a).trim();
  b = String(b == null ? "" : b).trim();
  if (!a || !b) return false;
  if (isPinHash_(b)) {
    var parts = b.split("$");
    if (parts.length !== 3) return false;
    return pinDigest_(parts[1], a) === parts[2];
  }
  if (a === b) return true;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return a.replace(/^0+/, "") === b.replace(/^0+/, "");
  return false;
}

/** Simpan PIN dalam bentuk teracak (tidak bisa dibaca siapa pun yang membuka sheet). */
function writePin_(sheet, rowNum, colIdx, pin) {
  var cell = sheet.getRange(rowNum, colIdx + 1);
  try { cell.setNumberFormat("@"); } catch(e) {}
  var p = String(pin == null ? "" : pin).trim();
  cell.setValue(p ? hashPin_(p) : "");
}

/** Sekali jalan: acak semua PIN polos lama di sheet Tokens. */
function hashStoredPins_() {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty("PINS_HASHED_V1") === "1") return;
    var ss = getSpreadsheet();
    var sheet = ss ? ss.getSheetByName(SHEET_TOKENS) : null;
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data && data.length > 1) {
      var colMap = getTokenColumnIndexes(data[0]);
      if (colMap.personalPin === undefined) return;
      for (var i = 1; i < data.length; i++) {
        var raw = String(data[i][colMap.personalPin] == null ? "" : data[i][colMap.personalPin]).trim();
        if (raw && !isPinHash_(raw) && hasStoredPin_(raw)) {
          writePin_(sheet, i + 1, colMap.personalPin, raw);
        }
      }
    }
    props.setProperty("PINS_HASHED_V1", "1");
  } catch(e) {}
}

function parseDevices_(raw) {
  try { var d = raw ? JSON.parse(raw) : []; return Array.isArray(d) ? d : []; } catch(e) { return []; }
}
function deviceIndex_(devices, deviceId) {
  if (!deviceId) return -1;
  for (var d = 0; d < devices.length; d++) {
    if (devices[d] && devices[d].deviceId === deviceId) return d;
  }
  return -1;
}

// Jika Anda membuat script Apps Script ini langsung dari https://script.google.com (Standalone Script)
// dan BUKAN dari menu Ekstensi di dalam Google Sheet, masukkan Link/URL atau ID Google Sheet Anda di sini:
var SPREADSHEET_URL_OR_ID = "https://docs.google.com/spreadsheets/d/1782VpWnlNbE2K7xdI5rbeTubRCBLn3vlOsdONksRdcs/edit";

// Nama sheet penyimpanan
var SHEET_TOKENS = "Tokens";
var SHEET_LOGS = "Logs";
var SHEET_ORDERS = "Orders";

/**
 * Mendapatkan referensi Google Spreadsheet (mendukung Container-bound di Google Sheet maupun Standalone Script)
 */
function getSpreadsheet() {
  // 1. Coba spreadsheet aktif (jika script dibuka dari menu Ekstensi > Apps Script di dalam Google Sheet)
  try {
    var ssActive = SpreadsheetApp.getActiveSpreadsheet();
    if (ssActive) return ssActive;
  } catch(e) {}

  // 2. Coba buka dari SPREADSHEET_URL_OR_ID jika pengguna mengisinya
  if (SPREADSHEET_URL_OR_ID && typeof SPREADSHEET_URL_OR_ID === 'string' && SPREADSHEET_URL_OR_ID.trim()) {
    var raw = SPREADSHEET_URL_OR_ID.trim();
    try {
      if (raw.indexOf("http") === 0) {
        return SpreadsheetApp.openByUrl(raw);
      } else {
        return SpreadsheetApp.openById(raw);
      }
    } catch(err) {
      Logger.log("Gagal membuka spreadsheet dari SPREADSHEET_URL_OR_ID: " + err);
    }
  }

  // 3. Coba dari ScriptProperties jika pernah disimpan sebelumnya
  try {
    var savedId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (savedId) {
      if (savedId.indexOf("http") === 0) return SpreadsheetApp.openByUrl(savedId);
      return SpreadsheetApp.openById(savedId);
    }
  } catch(e) {}

  return null;
}

/**
 * Pemetaan indeks kolom fleksibel berdasarkan nama header sheet Tokens.
 * Mencegah kesalahan pembacaan jika ada urutan kolom yang bergeser.
 */
function getTokenColumnIndexes(headers) {
  var map = {
    token: 0,
    buyerName: 1,
    buyerContact: 2,
    maxDevices: 3,
    deviceCount: 4,
    usedDevices: 5,
    status: 6,
    pinStatus: 7,
    personalPin: 8,
    createdAt: 9,
    notes: 10,
    cloudUrl: 11,
    buyerEmail: 12,
    spreadsheetId: 13
  };

  if (!headers || !headers.length) return map;

  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (h === "token" || h.includes("lisensi")) map.token = c;
    else if (h.includes("emailgoogle") || h.includes("googleemail") || (h.includes("email") && (h.includes("byodb") || h.includes("bound") || h.includes("akun")))) map.buyerEmail = c;
    else if (h.includes("spreadsheetid") || h.includes("sheetid") || (h.includes("spreadsheet") && h.includes("byodb"))) map.spreadsheetId = c;
    else if (h.includes("buyername") || h.includes("namapembeli") || h === "nama") map.buyerName = c;
    else if (h.includes("contact") || h.includes("kontak") || h.includes("email") || h.includes("wa")) map.buyerContact = c;
    else if (h.includes("max") || h.includes("kuota")) map.maxDevices = c;
    else if (h.includes("count") || h.includes("terpakai") || h.includes("jumlah")) map.deviceCount = c;
    else if (h.includes("devices") || h.includes("perangkat") || h.includes("json")) map.usedDevices = c;
    else if (h.includes("pinstatus") || h === "pinstatus") map.pinStatus = c;
    else if (h.includes("personalpin") || h.includes("pinpribadi") || (h.includes("pin") && !h.includes("status"))) map.personalPin = c;
    else if (h.includes("status") && !h.includes("pin")) map.status = c;
    else if (h.includes("created") || h.includes("dibuat") || h.includes("tanggal")) map.createdAt = c;
    else if (h.includes("notes") || h.includes("catatan") || h.includes("keterangan")) map.notes = c;
    else if (h.includes("cloud") || h.includes("database") || h.includes("sheeturl")) map.cloudUrl = c;
  }
  return map;
}

/**
 * Pemetaan indeks kolom fleksibel berdasarkan nama header sheet Orders.
 * Mencegah kesalahan pembacaan jika ada urutan kolom yang bergeser.
 */
function getOrderColumnIndexes(headers) {
  var map = {
    orderId: 0,
    timestamp: 1,
    buyerName: 2,
    whatsapp: 3,
    email: 4,
    package: 5,
    maxDevices: 6,
    price: 7,
    paymentMethod: 8,
    paymentProof: 9,
    status: 10,
    token: 11,
    notes: 12,
    updatedAt: 13
  };

  if (!headers || !headers.length) return map;

  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (h === "orderid" || h === "id" || h.includes("orderid")) map.orderId = c;
    else if (h.includes("time") || h.includes("waktu") || h.includes("tanggal")) map.timestamp = c;
    else if (h.includes("buyer") || h.includes("pemesan") || h.includes("nama")) map.buyerName = c;
    else if (h.includes("wa") || h.includes("whatsapp") || h.includes("hp") || h.includes("kontak")) map.whatsapp = c;
    else if (h.includes("email")) map.email = c;
    else if (h.includes("pack") || h.includes("paket")) map.package = c;
    else if (h.includes("device") || h.includes("perangkat") || h.includes("kuota")) map.maxDevices = c;
    else if (h.includes("price") || h.includes("harga") || h.includes("nominal")) map.price = c;
    else if (h.includes("method") || h.includes("metode")) map.paymentMethod = c;
    else if (h.includes("proof") || h.includes("bukti")) map.paymentProof = c;
    else if (h.includes("status")) map.status = c;
    else if (h.includes("token") || h.includes("lisensi")) map.token = c;
    else if (h.includes("notes") || h.includes("catatan") || h.includes("keterangan")) map.notes = c;
    else if (h.includes("update") || h.includes("diperbarui")) map.updatedAt = c;
  }
  return map;
}

/**
 * Inisialisasi otomatis struktur sheet jika belum ada atau update kolom
 */
function initSheets() {
  var ss = getSpreadsheet();
  if (!ss) {
    throw new Error("Google Spreadsheet tidak ditemukan. Buka file Google Sheet Database Lisensi Anda > klik menu Ekstensi > Apps Script, ATAU tempelkan Link Google Sheet ke baris SPREADSHEET_URL_OR_ID di file script.");
  }
  
  // Sheet Tokens
  var tokensSheet = ss.getSheetByName(SHEET_TOKENS);
  if (!tokensSheet) {
    tokensSheet = ss.insertSheet(SHEET_TOKENS);
    tokensSheet.appendRow([
      "Token", "Buyer Name", "Buyer Contact", "Max Devices", 
      "Device Count", "Used Devices (JSON)", "Status", "PIN Status", "Personal PIN", "Created At", "Notes", "Cloud URL", "Email Google (BYODb)", "Spreadsheet ID (BYODb)"
    ]);
    tokensSheet.getRange("A1:N1").setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    tokensSheet.setFrozenRows(1);
  } else {
    // Normalisasi cerdas header & kolom
    var lastCol = tokensSheet.getLastColumn();
    var lastRow = tokensSheet.getLastRow();
    var headers = lastCol > 0 ? tokensSheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    
    var hasPinStatus = headers.some(function(h) { 
      return String(h).toLowerCase().replace(/[^a-z]/g, '').includes("pinstatus"); 
    });

    if (!hasPinStatus) {
      if (lastCol >= 7) {
        tokensSheet.insertColumnsBefore(8, 2);
        tokensSheet.getRange(1, 8).setValue("PIN Status");
        tokensSheet.getRange(1, 9).setValue("Personal PIN");
        tokensSheet.getRange(1, 10).setValue("Created At");
        tokensSheet.getRange(1, 11).setValue("Notes");
        
        if (lastRow > 1) {
          for (var r = 2; r <= lastRow; r++) {
            tokensSheet.getRange(r, 8).setValue("USING_TOKEN");
            tokensSheet.getRange(r, 9).setValue("");
          }
        }
      }
    }

    var hasCloudUrl = headers.some(function(h) { 
      return String(h).toLowerCase().replace(/[^a-z]/g, '').includes("cloud"); 
    });
    if (!hasCloudUrl && lastCol > 0) {
      tokensSheet.getRange(1, lastCol + 1).setValue("Cloud URL");
      tokensSheet.getRange(1, lastCol + 1).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
      lastCol++;
    }

    // Auto-detect dan tambahkan kolom Email Google (BYODb)
    var hasBuyerEmail = headers.some(function(h) {
      var s = String(h).toLowerCase().replace(/[^a-z]/g, '');
      return s.includes("emailgoogle") || s.includes("googleemail") || (s.includes("email") && s.includes("byodb"));
    });
    if (!hasBuyerEmail && lastCol > 0) {
      tokensSheet.getRange(1, lastCol + 1).setValue("Email Google (BYODb)");
      tokensSheet.getRange(1, lastCol + 1).setFontWeight("bold").setBackground("#1e293b").setFontColor("#38bdf8");
      lastCol++;
    }

    // Auto-detect dan tambahkan kolom Spreadsheet ID (BYODb)
    var hasSpreadsheetId = headers.some(function(h) {
      var s = String(h).toLowerCase().replace(/[^a-z]/g, '');
      return s.includes("spreadsheetid") || s.includes("sheetid") || (s.includes("spreadsheet") && s.includes("byodb"));
    });
    if (!hasSpreadsheetId && lastCol > 0) {
      tokensSheet.getRange(1, lastCol + 1).setValue("Spreadsheet ID (BYODb)");
      tokensSheet.getRange(1, lastCol + 1).setFontWeight("bold").setBackground("#1e293b").setFontColor("#38bdf8");
      lastCol++;
    }
  }
  
  // Sheet Logs
  var logsSheet = ss.getSheetByName(SHEET_LOGS);
  if (!logsSheet) {
    logsSheet = ss.insertSheet(SHEET_LOGS);
    logsSheet.appendRow(["Timestamp", "Event", "Token", "Buyer Name", "Device ID", "Device Name", "Details"]);
    logsSheet.getRange("A1:G1").setFontWeight("bold").setBackground("#0f172a").setFontColor("#38bdf8");
    logsSheet.setFrozenRows(1);
  }

  // Sheet Orders (Daftar Pemesanan)
  var ordersSheet = ss.getSheetByName(SHEET_ORDERS);
  if (!ordersSheet) {
    ordersSheet = ss.insertSheet(SHEET_ORDERS);
    ordersSheet.appendRow([
      "Order ID", "Timestamp", "Buyer Name", "WhatsApp", "Email", 
      "Package", "Max Devices", "Price", "Payment Method", "Payment Proof", "Status", "Token", "Notes", "Updated At"
    ]);
    ordersSheet.getRange("A1:N1").setFontWeight("bold").setBackground("#0f172a").setFontColor("#38bdf8");
    ordersSheet.setFrozenRows(1);
  } else {
    // Cek jika kolom "Payment Proof" belum ada di sheet Orders yang sudah ada
    var lastColOrd = ordersSheet.getLastColumn();
    if (lastColOrd > 0) {
      var ordHeaders = ordersSheet.getRange(1, 1, 1, lastColOrd).getValues()[0];
      var hasProof = ordHeaders.some(function(h) {
        return String(h).toLowerCase().replace(/[^a-z]/g, '').includes("proof") || String(h).toLowerCase().replace(/[^a-z]/g, '').includes("bukti");
      });
      if (!hasProof) {
        ordersSheet.insertColumnsBefore(10, 1);
        ordersSheet.getRange(1, 10).setValue("Payment Proof");
        ordersSheet.getRange(1, 10).setFontWeight("bold").setBackground("#0f172a").setFontColor("#38bdf8");
      }
    }
  }
}

/**
 * Menyimpan data keuangan pengguna secara otomatis ke tab Spreadsheet:
 * 1. Sheet 'Database_Keuangan': Cadangan lengkap format JSON untuk sinkronisasi multi-device
 * 2. Sheet 'Transaksi': Tabel riwayat transaksi rapi & mudah dibaca
 * 3. Sheet 'Rekening_Saldo': Tabel daftar rekening & saldo terkini
 */
function saveFinancialDataToSheets(rawData, parsedData) {
  try {
    var ss = getSpreadsheet();
    if (!ss) return;

// 1. Cadangan Full JSON ke Sheet Database_Keuangan dengan teknik Chunking (Aman dari limit 50.000 karakter per sel)
    var dbSheet = ss.getSheetByName("Database_Keuangan");
    if (!dbSheet) {
      dbSheet = ss.insertSheet("Database_Keuangan");
    }
    dbSheet.clear();
    dbSheet.getRange("A1:B1").setValues([["Cadangan JSON Database Keuangan (Chunking)", "Diperbarui: " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")]]);
    dbSheet.getRange("A1:B1").setFontWeight("bold").setBackground("#1e293b").setFontColor("#38bdf8");

    var CHUNK_SIZE = 40000;
    var chunks = [];
    for (var i = 0; i < rawData.length; i += CHUNK_SIZE) {
      chunks.push([rawData.substring(i, i + CHUNK_SIZE)]);
    }
    if (chunks.length > 0) {
      dbSheet.getRange(2, 1, chunks.length, 1).setValues(chunks);
    }

    // 2. Format & Update Sheet Transaksi jika ada riwayat transaksi
    if (parsedData && parsedData.recentHistory && Array.isArray(parsedData.recentHistory)) {
      var txSheet = ss.getSheetByName("Transaksi");
      if (!txSheet) {
        txSheet = ss.insertSheet("Transaksi");
      }
      txSheet.clear();
      txSheet.appendRow(["Tanggal", "Tipe", "Kategori", "Pos / Rekening", "Nominal (Rp)", "Catatan"]);
      txSheet.getRange("A1:F1").setFontWeight("bold").setBackground("#0f172a").setFontColor("#38bdf8");
      txSheet.setFrozenRows(1);

      var history = parsedData.recentHistory;
      if (history.length > 0) {
        var rows = [];
        for (var t = 0; t < history.length; t++) {
          var item = history[t];
          rows.push([
            String(item.date || ""),
            String(item.type || "").toUpperCase(),
            String(item.category || "-"),
            String(item.account || "-"),
            Number(item.amount) || 0,
            String(item.notes || "")
          ]);
        }
        if (rows.length > 0) {
          txSheet.getRange(2, 1, rows.length, 6).setValues(rows);
          txSheet.getRange(2, 5, rows.length, 1).setNumberFormat("#,##0");
        }
      }
    }

    // 3. Format & Update Sheet Rekening_Saldo
    if (parsedData && parsedData.accounts && Array.isArray(parsedData.accounts)) {
      var accSheet = ss.getSheetByName("Rekening_Saldo");
      if (!accSheet) {
        accSheet = ss.insertSheet("Rekening_Saldo");
      }
      accSheet.clear();
      accSheet.appendRow(["Nama Rekening / Dompet", "Saldo Saat Ini (Rp)"]);
      accSheet.getRange("A1:B1").setFontWeight("bold").setBackground("#0f172a").setFontColor("#10b981");
      accSheet.setFrozenRows(1);

      var accounts = parsedData.accounts;
      var balances = parsedData.currentBalances || {};
      var accRows = [];
      for (var a = 0; a < accounts.length; a++) {
        var accName = accounts[a];
        var bal = Number(balances[accName]) || 0;
        accRows.push([accName, bal]);
      }
      if (accRows.length > 0) {
        accSheet.getRange(2, 1, accRows.length, 2).setValues(accRows);
        accSheet.getRange(2, 2, accRows.length, 1).setNumberFormat("#,##0");
      }
    }
  } catch(err) {
    // Jangan biarkan error sheet mengganggu proses respon
  }
}

function readFinancialDataFromSheets(ss) {
  if (!ss) return null;
  var dbSheet = ss.getSheetByName("Database_Keuangan");
  if (!dbSheet) return null;
  var lastRow = dbSheet.getLastRow();
  if (lastRow < 2) return null;
  var values = dbSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var result = "";
  for (var i = 0; i < values.length; i++) {
    result += values[i][0];
  }
  return (result && String(result).trim().startsWith("{")) ? String(result).trim() : null;
}

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  // 1. Jika ada parameter action, jalankan API Lisensi / Pairing / Admin
  if (params.action) {
    return handleRequest(params);
  }

  // 2. Tanpa action: server lisensi TIDAK lagi melayani data keuangan.
  // (Dulu siapa pun bisa membaca/menimpa data di sini tanpa login.)
  // Data keuangan disimpan di Google Sheet milik masing-masing pengguna / Cloud Script pribadi.
  return financialEndpointDisabled_();
}

function financialEndpointDisabled_() {
  return ContentService.createTextOutput(JSON.stringify({
    status: "disabled",
    success: false,
    message: "Server lisensi tidak menyimpan data keuangan. Gunakan Cloud Script pribadi atau Google Drive (BYODb)."
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var rawData = "";
  var params = {};

  if (e && e.postData && e.postData.contents) {
    rawData = e.postData.contents;
    try {
      params = JSON.parse(rawData);
    } catch(err) {
      params = e.parameter || {};
    }
  } else if (e && e.parameter) {
    params = e.parameter;
  }

  // 1. Jika ada parameter action, jalankan API Lisensi / Pairing / Admin
  if (params && params.action) {
    return handleRequest(params);
  }

  // 2. Tanpa action: upload data keuangan ke server lisensi sudah dimatikan (lihat doGet).
  return financialEndpointDisabled_();
}

// Aksi yang hanya membaca & tidak perlu antre kunci (LockService)
var READ_ONLY_ACTIONS = {
  "create_pair_session": true,
  "check_pair_session": true,
  "get_public_catalog": true,
  "check_voucher": true,
  "admin_login": true,
  "admin_get_data": true,
  "admin_check_fonnte_device": true
};

function handleRequest(params) {
  var action = params.action || "";
  var result = { success: false, message: "Action tidak dikenal" };
  var lock = null;

  try {
    // Catatan keamanan: parameter "sheetUrl" dari luar TIDAK lagi diterima
    // (dulu siapa pun bisa memindahkan database lisensi ke spreadsheet lain).

    // Antrekan aksi yang menulis data agar dua permintaan bersamaan tidak saling menimpa
    if (!READ_ONLY_ACTIONS[action]) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) {
        lock = null;
        return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Server sedang sibuk, silakan coba lagi beberapa detik lagi." }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    // Aksi pairing barcode sesi TIDAK memerlukan spreadsheet (hanya butuh CacheService)
    if (action !== "create_pair_session" && action !== "check_pair_session") {
      initSheets();
      purgeStoredCloudKeys_();
      if (lock) hashStoredPins_();
    }

    switch(action) {
      // -------------------------------------------------------------
      // API APLIKASI KLIEN
      // -------------------------------------------------------------
      case "validate_token":
        result = validateClientToken(params);
        break;

      // BYODb (Bring Your Own Database) Google Identity Services API
      case "verify_google_account":
        result = verifyGoogleAccount(params);
        break;

      case "bind_google_account":
        result = bindGoogleAccount(params);
        break;

      case "save_spreadsheet_id":
        result = saveSpreadsheetId(params);
        break;

      case "verify_status":
        result = verifyClientStatus(params);
        break;

      case "client_change_pin":
        result = clientChangePersonalPin(params);
        break;

      case "client_get_devices":
        result = clientGetDevices(params);
        break;

      case "deactivate_device":
      case "client_remove_device":
        result = deactivateClientDevice(params);
        break;

      // -------------------------------------------------------------
      // SISTEM PAIRING WHATSAPP WEB STYLE (PC/iPad Tampilkan QR, HP Utama Scan)
      // -------------------------------------------------------------
      case "create_pair_session":
        result = createPairSession(params);
        break;

      case "check_pair_session":
        result = checkPairSession(params);
        break;

      case "authorize_pair_session":
        result = authorizePairSession(params);
        break;

      // -------------------------------------------------------------
      // API DEVELOPER / ADMIN DASHBOARD
      // -------------------------------------------------------------
      case "admin_login":
        result = adminLogin(params);
        break;

      case "admin_change_password":
        result = adminChangePassword(params);
        break;

      case "admin_get_data":
        result = adminGetData(params);
        break;

      case "admin_generate_token":
        result = adminGenerateToken(params);
        break;

      case "admin_toggle_status":
        result = adminToggleStatus(params);
        break;

      case "admin_reactivate_token":
        result = adminReactivateToken(params);
        break;

      case "admin_reset_devices":
        result = adminResetDevices(params);
        break;

      case "admin_deactivate_device":
        result = adminDeactivateDevice(params);
        break;

      case "admin_delete_token":
        result = adminDeleteToken(params);
        break;

      case "admin_add_order":
        result = adminAddOrder(params);
        break;

      case "admin_update_order":
        result = adminUpdateOrder(params);
        break;

      case "admin_delete_order":
        result = adminDeleteOrder(params);
        break;

      case "admin_process_order_license":
        result = adminProcessOrderLicense(params);
        break;

      // -------------------------------------------------------------
      // API KATALOG PENJUALAN, VOUCHER & FORM PEMESANAN PUBLIK
      // -------------------------------------------------------------
      case "get_public_catalog":
        result = getPublicCatalog(params);
        break;

      case "check_voucher":
        result = checkVoucher(params);
        break;

      case "submit_public_order":
        result = submitPublicOrder(params);
        break;

      case "admin_save_sales_settings":
        result = adminSaveSalesSettings(params);
        break;

      case "admin_set_order_mode":
        result = adminSetOrderMode(params);
        break;

      case "admin_send_fonnte":
        if (!checkAdminAuth(params.adminPassword)) {
          result = { success: false, status: false, message: "Akses ditolak: Password Admin salah." };
          break;
        }
        result = adminSendFonnte(params);
        break;

      case "admin_check_fonnte_device":
        if (!checkAdminAuth(params.adminPassword)) {
          result = { success: false, status: false, message: "Akses ditolak: Password Admin salah." };
          break;
        }
        result = adminCheckFonnteDevice(params);
        break;

      // -------------------------------------------------------------
      // API SINKRONISASI DATA KEUANGAN PENGGUNA
      // -------------------------------------------------------------
      case "get_financial_data":
      case "save_financial_data":
        // Dimatikan demi keamanan: server lisensi tidak menyimpan data keuangan siapa pun.
        result = { success: false, status: "disabled", message: "Server lisensi tidak menyimpan data keuangan." };
        break;

      default:
        result = { success: false, message: "Action tidak valid." };
    }
  } catch(err) {
    result = { success: false, message: "Server error: " + err.toString() };
  } finally {
    if (lock) {
      try { SpreadsheetApp.flush(); } catch(eFlush) {}
      try { lock.releaseLock(); } catch(eRel) {}
    }
  }

  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==============================================================================
// LOGIKA VALIDASI LISENSI KLIEN
// ==============================================================================

function validateClientToken(params) {
  var tokenInput = (params.token || "").trim().toUpperCase();
  var inputPin = (params.pin || "").trim();
  var deviceId = (params.deviceId || "").trim();
  var deviceName = (params.deviceName || "Perangkat Web").trim();

  if (!tokenInput) {
    return { success: false, message: "Harap masukkan Token Pembelian / Kode Lisensi Anda." };
  }
  if (!deviceId) {
    return { success: false, message: "Device ID tidak terdeteksi oleh sistem." };
  }
  // Perangkat "uji" dari form pemesanan tidak boleh memakan slot perangkat pembeli
  if (/^ORDER-TEST/i.test(deviceId)) {
    return { success: false, message: "Validasi token dari form pemesanan tidak didukung." };
  }
  if (isRateLimited_("PIN", tokenInput, 6)) {
    return { success: false, isBurned: true, message: "Terlalu banyak percobaan PIN yang salah. Tunggu 15 menit lalu coba lagi." };
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    return { success: false, message: "Database lisensi masih kosong." };
  }

  var colMap = getTokenColumnIndexes(data[0]);
  var cleanInputToken = tokenInput.replace(/[^A-Z0-9]/g, '');

  for (var i = 1; i < data.length; i++) {
    var rowToken = String(data[i][colMap.token] || "").trim().toUpperCase();
    var cleanRowToken = rowToken.replace(/[^A-Z0-9]/g, '');

    if (rowToken === tokenInput || (cleanInputToken && cleanRowToken === cleanInputToken)) {
      tokenInput = rowToken; // Gunakan format resmi canonical (dengan tanda strip)
      var buyerName = data[i][colMap.buyerName] || "";
      var maxDevices = parseInt(data[i][colMap.maxDevices]) || 3;
      if (maxDevices < 3) maxDevices = 3; // Standar lisensi resmi Keuanganku PRO Multi-Device minimal 3 perangkat
      // Kuota prioritas hanya untuk token pemilik/demo yang terdaftar persis (bukan berdasarkan nama)
      if (hasPriorityQuota_(tokenInput)) {
        maxDevices = Math.max(maxDevices, 10);
      }
      var status = String(data[i][colMap.status] || "ACTIVE").trim().toUpperCase();
      var pinStatus = String(data[i][colMap.pinStatus] || "UNCLAIMED").trim().toUpperCase();
      var storedPersonalPin = String(data[i][colMap.personalPin] || "").trim();
      var rawDevices = data[i][colMap.usedDevices];

      var devices = [];
      try { devices = rawDevices ? JSON.parse(rawDevices) : []; } catch(e) { devices = []; }

      // -------------------------------------------------------------
      // ATURAN MUTLAK PERANGKAT PERTAMA (BRAND NEW TOKEN)
      // -------------------------------------------------------------
      // Jika devices.length === 0 (belum ada satu pun perangkat yang login):
      // Token ini 100% BARU / BELUM DIGUNAKAN.
      // Mustahil sudah dipersonalisasi di HP mana pun!
      // Wajib diizinkan login pertama kali sebagai USING_TOKEN!
      if (devices.length === 0) {
        pinStatus = "USING_TOKEN";
        storedPersonalPin = "";
        // Auto-heal data di Google Sheet jika sebelumnya sempat terisi salah
        if (data[i][colMap.pinStatus] === "PIN_CHANGED" || data[i][colMap.personalPin]) {
          try {
            sheet.getRange(i + 1, colMap.pinStatus + 1).setValue("USING_TOKEN");
            sheet.getRange(i + 1, colMap.personalPin + 1).setValue("");
          } catch(e) {}
        }
      } else {
        // Normalisasi hanya jika perangkat sudah pernah login (>0 devices)
        if (pinStatus !== "PIN_CHANGED" && hasStoredPin_(storedPersonalPin)) {
          pinStatus = "PIN_CHANGED";
        } else if (pinStatus !== "PIN_CHANGED") {
          // Jika perangkat sudah >= 2, pasti akun sudah dipersonalisasi.
          // (PIN yang dikirim perangkat baru TIDAK lagi dianggap bukti personalisasi.)
          if (devices.length >= 2) {
            pinStatus = "PIN_CHANGED";
          } else {
            pinStatus = "USING_TOKEN";
          }
        }
      }

      // 1. Cek Blokir
      if (status === "BLOCKED") {
        logEvent("BLOCKED_ATTEMPT", tokenInput, buyerName, deviceId, deviceName, "Percobaan login pada lisensi diblokir");
        return { 
          success: false, 
          message: "Lisensi ini telah dinonaktifkan oleh Developer. Hubungi Sambarang Production." 
        };
      }

      // 2. Cek apakah device ini sudah pernah terdaftar
      var existingDevice = null;
      for (var d = 0; d < devices.length; d++) {
        if (devices[d].deviceId === deviceId) {
          existingDevice = devices[d];
          break;
        }
      }

      // ATURAN 0: perangkat yang sudah dikeluarkan pengguna tidak bisa masuk lagi dengan PIN
      if (!existingDevice && isDeviceRemoved_(tokenInput, deviceId)) {
        logEvent("REMOVED_DEVICE_BLOCKED", tokenInput, buyerName, deviceId, deviceName, "Ditolak: perangkat yang sudah dikeluarkan mencoba masuk lagi dengan PIN");
        return { success: false, isBurned: true, deviceRemoved: true, message: REMOVED_DEVICE_MESSAGE };
      }

      // ATURAN 1: JIKA TOKEN SUDAH HANGUS (PIN SUDAH DIGANTI KE PRIBADI)
      if (pinStatus === "PIN_CHANGED" && devices.length > 0) {
        // Jika pembeli mencoba aktivasi perangkat baru, mereka HARUS menyertakan PIN Pribadinya!
        if (!existingDevice) {
          if (!inputPin) {
            logEvent("BURNED_TOKEN_BLOCKED", tokenInput, buyerName, deviceId, deviceName, "Ditolak: Token sudah hangus & butuh PIN pribadi");
            return {
              success: false,
              isBurned: true,
              message: "Token pembelian ini sudah HANGUS karena telah diaktivasi dan PIN telah diganti. Masukkan PIN Pribadi yang telah Anda buat untuk menghubungkan perangkat baru ini."
            };
          }
          if (!storedPersonalPin) {
            // PIN pribadi tidak tercatat di server: jangan terima PIN apa pun dari perangkat baru
            // (dulu PIN kiriman perangkat baru langsung disimpan = bisa dibajak).
            logEvent("NEW_DEVICE_NO_STORED_PIN", tokenInput, buyerName, deviceId, deviceName, "Ditolak: PIN pribadi belum tercatat di server");
            return {
              success: false,
              isBurned: true,
              message: "PIN pribadi lisensi ini belum tercatat di server. Tautkan perangkat baru lewat Scan QR dari HP utama Anda, atau hubungi developer."
            };
          }
          if (!pinEquals_(inputPin, storedPersonalPin)) {
            registerFailure_("PIN", tokenInput, 900);
            logEvent("WRONG_PERSONAL_PIN", tokenInput, buyerName, deviceId, deviceName, "Salah memasukkan PIN pribadi");
            return {
              success: false,
              isBurned: true,
              message: "PIN Pribadi salah! Masukkan PIN pribadi yang telah Anda buat sebelumnya."
            };
          }
          clearFailures_("PIN", tokenInput);
        } else {
          // JIKA PERANGKAT SUDAH TERDAFTAR (EXISTING DEVICE):
          // Jika inputPin dikirim untuk re-autentikasi:
          if (inputPin && storedPersonalPin && !pinEquals_(inputPin, storedPersonalPin)) {
            registerFailure_("PIN", tokenInput, 900);
            logEvent("WRONG_PERSONAL_PIN_EXISTING", tokenInput, buyerName, deviceId, deviceName, "Perangkat terdaftar salah memasukkan PIN pribadi");
            return {
              success: false,
              message: "PIN Pribadi salah! Masukkan PIN pribadi yang benar."
            };
          }
        }
      }

      // ATURAN 2: JIKA MASIH TOKEN BAWAAN (BELUM GANTI PIN)
      if (pinStatus === "USING_TOKEN" || pinStatus === "UNCLAIMED") {
        // HANYA BOLEH 1 DEVICE!
        if (!existingDevice && devices.length >= 1) {
          logEvent("MULTI_DEVICE_BLOCKED_UNPERSONALIZED", tokenInput, buyerName, deviceId, deviceName, "Ditolak: Mencoba device ke-2 tanpa ganti PIN");
          return {
            success: false,
            message: "Token ini sudah aktif di 1 perangkat. Untuk keamanan dari pembagian ilegal, Anda WAJIB mengganti Token ke PIN Pribadi di perangkat pertama terlebih dahulu sebelum bisa membuka di perangkat kedua."
          };
        }
      }

      var currentCloudUrl = (colMap.cloudUrl !== undefined && data[i][colMap.cloudUrl]) ? stripCloudKey_(data[i][colMap.cloudUrl]) : "";
      if (params.cloudUrl && colMap.cloudUrl !== undefined && shouldReplaceCloudUrl_(currentCloudUrl, params.cloudUrl)) {
        currentCloudUrl = stripCloudKey_(params.cloudUrl);
        sheet.getRange(i + 1, colMap.cloudUrl + 1).setValue(currentCloudUrl);
      }

      // -------------------------------------------------------------
      // BYODb: PENGUNCIAN & TAUTAN AKUN GOOGLE (EMAIL BINDING)
      // Email hanya dipercaya jika sudah diverifikasi langsung ke Google (googleAccessToken).
      // -------------------------------------------------------------
      var inputEmail = params.googleAccessToken ? getVerifiedGoogleEmail_(params.googleAccessToken) : "";
      var boundEmail = (colMap.buyerEmail !== undefined && data[i][colMap.buyerEmail]) ? String(data[i][colMap.buyerEmail]).trim().toLowerCase() : "";
      var isOwnerToken = isOwnerToken_(tokenInput);

      if (inputEmail) {
        if (!boundEmail) {
          // Token belum terikat ke akun Google -> Tautkan permanen!
          if (colMap.buyerEmail !== undefined) {
            sheet.getRange(i + 1, colMap.buyerEmail + 1).setValue(inputEmail);
            boundEmail = inputEmail;
            logEvent("EMAIL_BOUND", tokenInput, buyerName, deviceId, deviceName, "Token lisensi berhasil ditautkan ke akun Google: " + inputEmail);
          }
        } else if (boundEmail !== inputEmail && !isOwnerToken) {
          // Token sudah terikat ke akun Google lain -> Tolak pembajakan!
          logEvent("EMAIL_MISMATCH_BLOCKED", tokenInput, buyerName, deviceId, deviceName, "Ditolak: Mencoba klaim token milik email lain (" + inputEmail + " vs " + boundEmail + ")");
          return {
            success: false,
            message: "Token ini telah terikat secara permanen dengan akun Google: " + maskEmail(boundEmail) + ". Silakan login menggunakan akun Google tersebut atau hubungi developer."
          };
        }
      }

      // Simpan Spreadsheet ID jika dikirimkan oleh klien
      var currentSpreadsheetId = (colMap.spreadsheetId !== undefined && data[i][colMap.spreadsheetId]) ? String(data[i][colMap.spreadsheetId]).trim() : "";
      if (params.spreadsheetId && colMap.spreadsheetId !== undefined) {
        var newSheetId = String(params.spreadsheetId).trim();
        // Hanya ID Google Sheet yang sah (cegah rumus/teks asing masuk ke sheet Tokens)
        if (newSheetId && /^[A-Za-z0-9_-]{20,100}$/.test(newSheetId) && newSheetId !== currentSpreadsheetId) {
          currentSpreadsheetId = newSheetId;
          sheet.getRange(i + 1, colMap.spreadsheetId + 1).setValue(currentSpreadsheetId);
        }
      }

      // 3. Cek apakah perangkat sudah ada (Re-login)
      // PIN yang dikirim perangkat terdaftar WAJIB benar (dulu PIN apa pun diterima bila
      // lisensi masih memakai token bawaan / PIN belum tercatat, sehingga layar kunci bisa dilewati).
      if (existingDevice && inputPin) {
        var existingPinOk = storedPersonalPin
          ? pinEquals_(inputPin, storedPersonalPin)
          : (normalizeToken_(inputPin) === normalizeToken_(tokenInput));
        if (!existingPinOk) {
          registerFailure_("PIN", tokenInput, 900);
          logEvent("WRONG_PIN_EXISTING_DEVICE", tokenInput, buyerName, deviceId, deviceName, "Perangkat terdaftar memasukkan PIN yang tidak cocok");
          return { success: false, message: "PIN salah! Masukkan PIN pribadi yang benar (atau Token Lisensi bila belum membuat PIN pribadi)." };
        }
        clearFailures_("PIN", tokenInput);
      }
      if (existingDevice) {
        existingDevice.lastActive = new Date().toISOString();
        existingDevice.deviceName = deviceName;
        sheet.getRange(i + 1, colMap.usedDevices + 1).setValue(JSON.stringify(devices));

        logEvent("RE_LOGIN", tokenInput, buyerName, deviceId, deviceName, "Masuk kembali di perangkat terdaftar");
        return {
          success: true,
          message: "Verifikasi berhasil!",
          data: {
            token: tokenInput,
            buyerName: buyerName,
            email: boundEmail || inputEmail,
            spreadsheetId: currentSpreadsheetId,
            pinStatus: pinStatus,
            // PIN hanya dikembalikan bila baru saja diketik & terbukti benar (server tidak menyimpan PIN polos)
            personalPin: inputPin || "",
            isPasswordChanged: (pinStatus === "PIN_CHANGED"),
            maxDevices: (pinStatus === "PIN_CHANGED" ? maxDevices : 1),
            deviceCount: devices.length,
            activatedAt: existingDevice.activatedAt,
            cloudUrl: currentCloudUrl
          }
        };
      }

      // 4. Jika Perangkat Baru & Kuota Maksimal Perangkat Tercapai
      if (devices.length >= maxDevices) {
        logEvent("MAX_DEVICES_EXCEEDED", tokenInput, buyerName, deviceId, deviceName, "Gagal: Kuota " + maxDevices + " perangkat penuh");
        return {
          success: false,
          message: "Batas kuota perangkat telah penuh (Maksimal " + maxDevices + " perangkat). Silakan hubungi Developer untuk reset slot perangkat Anda."
        };
      }

      // 5. Daftarkan Perangkat Baru
      var newDevObj = {
        deviceId: deviceId,
        deviceName: deviceName,
        activatedAt: new Date().toISOString(),
        lastActive: new Date().toISOString()
      };
      devices.push(newDevObj);

      // Jika pertama kali dipakai, ubah status dari UNCLAIMED menjadi USING_TOKEN
      var newPinStatus = (pinStatus === "UNCLAIMED") ? "USING_TOKEN" : pinStatus;

      sheet.getRange(i + 1, colMap.deviceCount + 1).setValue(devices.length);
      sheet.getRange(i + 1, colMap.usedDevices + 1).setValue(JSON.stringify(devices));
      sheet.getRange(i + 1, colMap.pinStatus + 1).setValue(newPinStatus);

      logEvent("DEVICE_ACTIVATED", tokenInput, buyerName, deviceId, deviceName, "Perangkat ke-" + devices.length + " berhasil terdaftar (Status: " + newPinStatus + ")");

      return {
        success: true,
        message: "Selamat! Aplikasi Keuanganku PRO berhasil diaktivasi di perangkat ini.",
        data: {
          token: tokenInput,
          buyerName: buyerName,
          email: boundEmail || inputEmail,
          spreadsheetId: currentSpreadsheetId,
          pinStatus: newPinStatus,
          personalPin: inputPin || "",
          isPasswordChanged: (newPinStatus === "PIN_CHANGED"),
          maxDevices: (newPinStatus === "PIN_CHANGED" ? maxDevices : 1),
          deviceCount: devices.length,
          activatedAt: newDevObj.activatedAt,
          cloudUrl: currentCloudUrl
        }
      };
    }
  }

  // Auto-provisioning resmi untuk Akun Demo Iklan jika belum ada di database
  if (tokenInput === 'PRO-DEMO-IKLAN-2026') {
    var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    var demoDevObj = [{
      deviceId: deviceId,
      deviceName: deviceName,
      activatedAt: nowStr,
      lastActive: nowStr
    }];
    sheet.appendRow(safeRow_([
      "PRO-DEMO-IKLAN-2026",
      "Akun Demo Iklan (Official Showcase)",
      "087788197916 | demo@keuanganku.id",
      10,
      1,
      JSON.stringify(demoDevObj),
      "ACTIVE",
      "USING_TOKEN",
      "",
      nowStr,
      "Akun Resmi Percontohan Khusus Iklan & Promosi (Showcase)"
    ]));
    logEvent("DEVICE_ACTIVATED", "PRO-DEMO-IKLAN-2026", "Akun Demo Iklan (Official Showcase)", deviceId, deviceName, "Perangkat resmi terdaftar di Akun Demo Iklan");
    return {
      success: true,
      message: "Selamat datang di Akun Percontohan Iklan KeuanganKu!",
      data: {
        token: "PRO-DEMO-IKLAN-2026",
        buyerName: "Akun Demo Iklan (Official Showcase)",
        pinStatus: "USING_TOKEN",
        isPasswordChanged: false,
        maxDevices: 10,
        deviceCount: 1,
        activatedAt: nowStr,
        cloudUrl: ""
      }
    };
  }

  logEvent("INVALID_TOKEN", tokenInput, "-", deviceId, deviceName, "Token tidak terdaftar dalam database master");
  return { success: false, message: "Token Pembelian tidak ditemukan. Pastikan Anda memasukkan kode yang benar dari bukti pemesanan." };
}

// ==============================================================================
// SISTEM PAIRING WHATSAPP WEB STYLE (PC/iPad Tampilkan QR, HP Utama Scan)
// ==============================================================================

function createPairSession(params) {
  var sessionId = (params.sessionId || "").trim();
  var deviceId = (params.deviceId || "").trim();
  var deviceName = (params.deviceName || "Perangkat Web").trim();

  // ID sesi harus panjang & acak agar tidak bisa ditebak. ID pendek dari klien diganti ID server.
  if (!sessionId || sessionId.length < 16 || !/^[A-Za-z0-9-]+$/.test(sessionId)) {
    sessionId = "PAIR-" + Utilities.getUuid().replace(/-/g, "").toUpperCase();
  }
  if (!deviceId) {
    return { success: false, message: "Device ID tidak terdeteksi." };
  }

  var cache = CacheService.getScriptCache();
  // Jangan izinkan sesi yang sudah ada ditimpa (mencegah pembajakan barcode)
  var existingRaw = cache.get(sessionId);
  if (existingRaw) {
    try {
      var existingObj = JSON.parse(existingRaw);
      if (existingObj && existingObj.deviceId !== deviceId) {
        return { success: false, message: "Sesi barcode sudah dipakai. Muat ulang barcode." };
      }
      if (existingObj && existingObj.status === "AUTHORIZED") {
        return { success: true, sessionId: sessionId, status: "AUTHORIZED" };
      }
    } catch(e) {}
  }
  var sessionObj = {
    status: "WAITING",
    sessionId: sessionId,
    deviceId: deviceId,
    deviceName: deviceName,
    createdAt: Date.now()
  };

  // Simpan di cache Google Apps Script selama 600 detik (10 menit)
  cache.put(sessionId, JSON.stringify(sessionObj), 600);

  return {
    success: true,
    sessionId: sessionId,
    status: "WAITING",
    message: "Sesi pairing barcode berhasil dibuat."
  };
}

function checkPairSession(params) {
  var sessionId = (params.sessionId || "").trim();
  if (!sessionId) {
    return { success: false, status: "EXPIRED", message: "Session ID tidak ditemukan." };
  }

  var cache = CacheService.getScriptCache();
  var raw = cache.get(sessionId);
  if (!raw) {
    return { success: true, status: "WAITING", message: "Menunggu scan dari HP Utama..." };
  }

  var sessionObj = JSON.parse(raw);
  var requesterDeviceId = String(params.deviceId || "").trim();

  if (sessionObj.status !== "AUTHORIZED") {
    return { success: true, status: sessionObj.status || "WAITING" };
  }

  // Data lisensi & PIN hanya diberikan ke perangkat yang membuat barcode ini
  if (!requesterDeviceId || requesterDeviceId !== sessionObj.deviceId) {
    return { success: true, status: "WAITING", message: "Menunggu scan dari HP Utama..." };
  }

  // Sekali ambil: setelah dibaca oleh perangkat yang benar, sesi dihapus
  try { cache.remove(sessionId); } catch(e) {}
  return {
    success: true,
    status: sessionObj.status,
    session: sessionObj
  };
}

function authorizePairSession(params) {
  var sessionId = (params.sessionId || "").trim();
  var tokenInput = (params.token || "").trim().toUpperCase();
  var inputPin = (params.pin || "").trim();
  var approverDeviceId = (params.approverDeviceId || "").trim();

  if (!sessionId) {
    return { success: false, message: "Session ID barcode tidak valid." };
  }
  if (!tokenInput) {
    return { success: false, message: "Token lisensi tidak valid." };
  }

  if (!approverDeviceId) {
    return { success: false, message: "Aplikasi di HP utama perlu dimuat ulang (versi lama). Tutup lalu buka kembali aplikasi, kemudian scan ulang." };
  }
  if (isRateLimited_("PIN", tokenInput, 6)) {
    return { success: false, message: "Terlalu banyak percobaan PIN yang salah. Tunggu 15 menit lalu coba lagi." };
  }

  var cache = CacheService.getScriptCache();
  var raw = cache.get(sessionId);
  var sessionObj = null;
  if (raw) {
    try { sessionObj = JSON.parse(raw); } catch(e) {}
  }
  // Sesi WAJIB dibuat oleh perangkat baru lebih dulu (tidak boleh dibuat dari sisi HP utama)
  if (!sessionObj || !sessionObj.deviceId) {
    return { success: false, message: "Barcode sudah kedaluwarsa. Muat ulang barcode di perangkat baru lalu scan lagi." };
  }
  if (sessionObj.status === "AUTHORIZED") {
    return { success: false, message: "Barcode ini sudah dipakai. Muat ulang barcode di perangkat baru." };
  }

  var targetDeviceId = sessionObj.deviceId;
  var targetDeviceName = sessionObj.deviceName || (params.targetDeviceName || "").trim() || "Perangkat Tambahan";

  // Validasi lisensi di Spreadsheet Tokens
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    return { success: false, message: "Database lisensi masih kosong." };
  }
  var colMap = getTokenColumnIndexes(data[0]);
  var cleanInputToken = tokenInput.replace(/[^A-Z0-9]/g, '');

  var foundRow = -1;
  var rowData = null;

  for (var i = 1; i < data.length; i++) {
    var rowToken = String(data[i][colMap.token] || "").trim().toUpperCase();
    var cleanRowToken = rowToken.replace(/[^A-Z0-9]/g, '');
    if (rowToken === tokenInput || (cleanInputToken && cleanRowToken === cleanInputToken)) {
      foundRow = i + 1;
      rowData = data[i];
      tokenInput = rowToken;
      break;
    }
  }

  if (foundRow === -1 || !rowData) {
    return { success: false, message: "Token lisensi tidak terdaftar dalam database." };
  }

  var buyerName = rowData[colMap.buyerName] || "";
  var maxDevices = parseInt(rowData[colMap.maxDevices]) || 3;
  if (maxDevices < 3) maxDevices = 3;
  var status = String(rowData[colMap.status] || "ACTIVE").trim().toUpperCase();
  var pinStatus = String(rowData[colMap.pinStatus] || "UNCLAIMED").trim().toUpperCase();
  var storedPersonalPin = String(rowData[colMap.personalPin] || "").trim();
  var rawDevices = rowData[colMap.usedDevices];

  // Prioritas Kuota Developer / Pemilik Akun
  if (hasPriorityQuota_(tokenInput)) {
    maxDevices = Math.max(maxDevices, 10);
  }

  if (status === "BLOCKED") {
    return { success: false, message: "Lisensi ini sedang diblokir oleh developer." };
  }

  // Parse devices
  var devices = parseDevices_(rawDevices);

  // HP yang menyetujui (scan barcode) HARUS perangkat yang sudah terdaftar di lisensi ini
  if (deviceIndex_(devices, approverDeviceId) === -1) {
    logEvent("PAIR_REJECTED_UNKNOWN_APPROVER", tokenInput, buyerName, approverDeviceId, "-", "Ditolak: HP penyetuju tidak terdaftar di lisensi");
    return { success: false, message: "HP ini belum terdaftar sebagai perangkat lisensi " + tokenInput + ". Masuk ulang dengan Token + PIN di HP ini terlebih dahulu." };
  }

  // Jika lisensi sudah punya PIN pribadi, PIN yang dikirim HP utama harus cocok
  if (storedPersonalPin && !pinEquals_(inputPin, storedPersonalPin)) {
    registerFailure_("PIN", tokenInput, 900);
    logEvent("PAIR_WRONG_PIN", tokenInput, buyerName, approverDeviceId, "-", "Ditolak: PIN tidak cocok saat menautkan perangkat");
    return { success: false, message: "PIN di HP utama tidak cocok dengan PIN lisensi. Buka Setup > ganti/konfirmasi PIN lalu coba lagi." };
  }

  // Cek apakah device sudah terdaftar
  var existing = false;
  for (var d = 0; d < devices.length; d++) {
    if (devices[d].deviceId === targetDeviceId) {
      existing = true;
      devices[d].lastActive = new Date().toISOString();
      devices[d].deviceName = targetDeviceName;
      break;
    }
  }

  if (!existing) {
    if (devices.length >= maxDevices) {
      return {
        success: false,
        message: "Batas kuota perangkat telah penuh (Maksimal " + maxDevices + " perangkat). Silakan kelola slot perangkat Anda di Developer Dashboard."
      };
    }
    // Ditautkan lewat QR yang disetujui perangkat terdaftar: perangkat yang dulu dikeluarkan boleh kembali
    unmarkDeviceRemoved_(tokenInput, targetDeviceId);
    devices.push({
      deviceId: targetDeviceId,
      deviceName: targetDeviceName,
      activatedAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    });
  }

  // Simpan update devices ke Sheet
  sheet.getRange(foundRow, colMap.deviceCount + 1).setValue(devices.length);
  sheet.getRange(foundRow, colMap.usedDevices + 1).setValue(JSON.stringify(devices));

  // Pastikan status pinStatus adalah PIN_CHANGED dan personalPin tersimpan di database token.
  // PIN lama yang sudah tersimpan TIDAK pernah ditimpa dari sini.
  if (!storedPersonalPin && inputPin && inputPin.length >= 3) {
    writePin_(sheet, foundRow, colMap.personalPin, inputPin);
    storedPersonalPin = "set";
  }
  // PIN polos untuk perangkat baru = PIN yang barusan diketik & terbukti benar di HP utama
  var pinForNewDevice = storedPersonalPin ? inputPin : "";
  if (storedPersonalPin) {
    pinStatus = "PIN_CHANGED";
    sheet.getRange(foundRow, colMap.pinStatus + 1).setValue("PIN_CHANGED");
  }
  clearFailures_("PIN", tokenInput);

  logEvent("PAIR_SESSION_AUTHORIZED", tokenInput, buyerName, targetDeviceId, targetDeviceName, "Perangkat berhasil ditautkan via Scan HP WhatsApp Style");

  var currentCloudUrl = (colMap.cloudUrl !== undefined && data[foundRow - 1][colMap.cloudUrl]) ? stripCloudKey_(data[foundRow - 1][colMap.cloudUrl]) : "";
  if (params.cloudUrl && colMap.cloudUrl !== undefined && shouldReplaceCloudUrl_(currentCloudUrl, params.cloudUrl)) {
    currentCloudUrl = stripCloudKey_(params.cloudUrl);
    sheet.getRange(foundRow, colMap.cloudUrl + 1).setValue(currentCloudUrl);
  }

  // URL Cloud BERKUNCI dari HP utama hanya dititipkan SEMENTARA di sesi barcode (maks. 5 menit,
  // dihapus setelah dibaca perangkat baru) dan TIDAK disimpan di sheet Tokens.
  var keyedCloudForPairing = String(params.cloudUrl || "").trim();
  if (keyedCloudForPairing.indexOf("https://script.google.com/") !== 0) keyedCloudForPairing = currentCloudUrl;

  // Update session di cache Google Apps Script agar PC/iPad langsung otomatis login
  sessionObj.status = "AUTHORIZED";
  sessionObj.deviceId = targetDeviceId;
  sessionObj.licenseData = {
    token: tokenInput,
    buyerName: buyerName,
    pinStatus: pinStatus,
    personalPin: pinForNewDevice,
    isPasswordChanged: (pinStatus === "PIN_CHANGED"),
    maxDevices: maxDevices,
    deviceCount: devices.length,
    cloudUrl: keyedCloudForPairing
  };
  sessionObj.pin = pinForNewDevice;
  var masterUrlParam = String(params.masterUrl || "").trim();
  sessionObj.masterUrl = (masterUrlParam.indexOf("https://script.google.com/") === 0) ? masterUrlParam : "";
  sessionObj.cloudUrl = keyedCloudForPairing;

  cache.put(sessionId, JSON.stringify(sessionObj), 300);

  return {
    success: true,
    message: "Perangkat '" + targetDeviceName + "' berhasil ditautkan!",
    deviceCount: devices.length,
    maxDevices: maxDevices
  };
}

/**
 * Pengguna Mengganti Token Bawaan ke PIN Pribadi
 * Ini yang membuat Token bawaan HANGUS dan membuka kuota multi-device + Cloud Sync
 */
function clientChangePersonalPin(params) {
  var tokenInput = (params.token || "").trim().toUpperCase();
  var newPin = (params.newPin || "").trim();
  var deviceId = (params.deviceId || "").trim();

  if (!tokenInput || !newPin) {
    return { success: false, message: "Token dan PIN baru tidak boleh kosong." };
  }
  // Akun demo dipakai bersama: PIN-nya tidak boleh diganti (agar tidak bisa "dibajak")
  if (tokensMatch_(tokenInput, DEMO_TOKEN)) {
    return { success: false, message: "PIN akun demo tidak bisa diganti." };
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    return { success: false, message: "Database lisensi masih kosong." };
  }
  var colMap = getTokenColumnIndexes(data[0]);

  var cleanInputToken = tokenInput.replace(/[^A-Z0-9]/g, '');

  for (var i = 1; i < data.length; i++) {
    var rowToken = String(data[i][colMap.token] || "").trim().toUpperCase();
    var cleanRowToken = rowToken.replace(/[^A-Z0-9]/g, '');
    if (rowToken === tokenInput || (cleanInputToken && cleanRowToken === cleanInputToken)) {
      tokenInput = rowToken;
      var buyerName = data[i][colMap.buyerName] || "";

      // Hanya perangkat yang sudah terdaftar di lisensi ini yang boleh mengganti PIN
      var pinDevices = parseDevices_(data[i][colMap.usedDevices]);
      if (deviceIndex_(pinDevices, deviceId) === -1) {
        logEvent("PIN_CHANGE_REJECTED", tokenInput, buyerName, deviceId, "-", "Ditolak: ganti PIN dari perangkat yang tidak terdaftar");
        return { success: false, message: "Perangkat ini tidak terdaftar di lisensi. Masuk ulang dengan Token + PIN terlebih dahulu." };
      }
      if (String(data[i][colMap.status] || "ACTIVE").trim().toUpperCase() === "BLOCKED") {
        return { success: false, message: "Lisensi ini sedang diblokir oleh developer." };
      }
      if (newPin.length < 4 || newPin.length > 20) {
        return { success: false, message: "PIN pribadi harus 4-20 karakter." };
      }

      // Update PIN Status menjadi PIN_CHANGED (Token Hangus) & simpan PIN Pribadi
      sheet.getRange(i + 1, colMap.pinStatus + 1).setValue("PIN_CHANGED");
      writePin_(sheet, i + 1, colMap.personalPin, newPin);

      logEvent("PIN_CHANGED_TOKEN_BURNED", tokenInput, buyerName, deviceId, "-", "Pengguna mengganti PIN pribadi. Token bawaan sekarang HANGUS & Cloud Sync terbuka.");

      return {
        success: true,
        message: "PIN Pribadi berhasil diaktifkan! Token bawaan kini hangus dan fitur Sinkronisasi Multi-Device telah terbuka.",
        pinStatus: "PIN_CHANGED"
      };
    }
  }

  return { success: false, message: "Token lisensi tidak ditemukan." };
}

function verifyClientStatus(params) {
  var tokenInput = (params.token || "").trim().toUpperCase();
  var deviceId = (params.deviceId || "").trim();

  if (!tokenInput || !deviceId) {
    return { success: false, active: false, message: "Parameter tidak lengkap" };
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { success: true, active: false, reason: "NOT_FOUND", message: "Token tidak terdaftar." };
  var colMap = getTokenColumnIndexes(data[0]);

  for (var i = 1; i < data.length; i++) {
    if (tokensMatch_(data[i][colMap.token], tokenInput)) {
      var status = String(data[i][colMap.status] || "ACTIVE").trim().toUpperCase();
      var pinStatus = String(data[i][colMap.pinStatus] || "UNCLAIMED").trim().toUpperCase();

      if (status !== "ACTIVE") {
        return { success: true, active: false, reason: "BLOCKED", message: "Lisensi ini telah dinonaktifkan." };
      }

      var rawDevices = data[i][colMap.usedDevices];
      var devices = [];
      try { devices = rawDevices ? JSON.parse(rawDevices) : []; } catch(e) {}

      var storedPersonalPin = String(data[i][colMap.personalPin] || "").trim();
      if (pinStatus !== "PIN_CHANGED" && hasStoredPin_(storedPersonalPin)) pinStatus = "PIN_CHANGED";
      else if (pinStatus !== "PIN_CHANGED" && devices.length > 0) pinStatus = "USING_TOKEN";

      var isFound = false;
      for (var d = 0; d < devices.length; d++) {
        if (devices[d].deviceId === deviceId) {
          isFound = true;
          devices[d].lastActive = new Date().toISOString();
          break;
        }
      }

      var isOwner = hasPriorityQuota_(tokenInput);
      var maxDevLimit = isOwner ? Math.max(parseInt(data[i][colMap.maxDevices]) || 3, 10) : Math.max(parseInt(data[i][colMap.maxDevices]) || 3, 3);

      // Perangkat yang belum terdaftar TIDAK lagi didaftarkan otomatis di sini
      // (dulu cukup tahu token saja sudah bisa menambah perangkat tanpa PIN).
      if (!isFound) {
        // Dikeluarkan secara sengaja oleh pemilik lisensi -> aplikasi di perangkat itu akan mengunci diri
        if (isDeviceRemoved_(tokenInput, deviceId)) {
          return { success: true, active: false, reason: "DEVICE_KICKED", message: REMOVED_DEVICE_MESSAGE };
        }
        return { success: true, active: false, reason: "DEVICE_REMOVED", message: "Perangkat ini belum/tidak lagi terdaftar di lisensi. Silakan masuk ulang dengan Token + PIN." };
      }

      var currentCloudUrl = (colMap.cloudUrl !== undefined && data[i][colMap.cloudUrl]) ? stripCloudKey_(data[i][colMap.cloudUrl]) : "";
      if (params.cloudUrl && colMap.cloudUrl !== undefined && shouldReplaceCloudUrl_(currentCloudUrl, params.cloudUrl)) {
        currentCloudUrl = stripCloudKey_(params.cloudUrl);
        sheet.getRange(i + 1, colMap.cloudUrl + 1).setValue(currentCloudUrl);
      }

      return { 
        success: true, 
        active: true, 
        buyerName: data[i][colMap.buyerName],
        pinStatus: pinStatus,
        isPasswordChanged: (pinStatus === "PIN_CHANGED"),
        deviceCount: devices.length,
        maxDevices: (isOwner ? maxDevLimit : Math.max(parseInt(data[i][colMap.maxDevices]) || 3, 3)),
        isOwner: isOwnerToken_(tokenInput),
        cloudUrl: currentCloudUrl
      };
    }
  }

  return { success: true, active: false, reason: "NOT_FOUND", message: "Token tidak terdaftar." };
}

function clientGetDevices(params) {
  var tokenInput = (params.token || "").trim().toUpperCase();
  var currentDeviceId = (params.deviceId || "").trim();

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { success: false, message: "Token lisensi tidak ditemukan." };
  var colMap = getTokenColumnIndexes(data[0]);

  for (var i = 1; i < data.length; i++) {
    if (tokensMatch_(data[i][colMap.token], tokenInput)) {
      var buyerName = data[i][colMap.buyerName];
      var status = String(data[i][colMap.status] || "ACTIVE").trim().toUpperCase();
      if (status !== "ACTIVE") {
        return { success: false, message: "Lisensi ini telah dinonaktifkan." };
      }

      var rawDevices = data[i][colMap.usedDevices];
      var devices = parseDevices_(rawDevices);

      // Daftar perangkat hanya boleh dilihat dari perangkat yang terdaftar
      if (deviceIndex_(devices, currentDeviceId) === -1) {
        return { success: false, message: "Perangkat ini tidak terdaftar di lisensi." };
      }

      var maxDevices = parseInt(data[i][colMap.maxDevices]) || 3;
      if (maxDevices < 3) maxDevices = 3;
      if (hasPriorityQuota_(tokenInput)) {
        maxDevices = Math.max(maxDevices, 10);
      }
      var pinStatus = String(data[i][colMap.pinStatus] || "UNCLAIMED").trim().toUpperCase();
      var storedPersonalPin = String(data[i][colMap.personalPin] || "").trim();

      if (pinStatus !== "PIN_CHANGED" && hasStoredPin_(storedPersonalPin)) pinStatus = "PIN_CHANGED";
      else if (pinStatus !== "PIN_CHANGED" && devices.length > 0) pinStatus = "USING_TOKEN";

      var mapped = devices.map(function(d) {
        return {
          deviceId: d.deviceId || "",
          deviceName: d.deviceName || "Perangkat Tidak Dikenal",
          activatedAt: d.activatedAt || "",
          lastActive: d.lastActive || d.activatedAt || "",
          isCurrent: (d.deviceId === currentDeviceId)
        };
      });

      return {
        success: true,
        token: tokenInput,
        buyerName: buyerName,
        pinStatus: pinStatus,
        maxDevices: (pinStatus === "PIN_CHANGED" ? maxDevices : 1),
        deviceCount: devices.length,
        devices: mapped
      };
    }
  }

  return { success: false, message: "Token lisensi tidak ditemukan." };
}

// ------------------------------------------------------------------------------
// PERANGKAT YANG DIKELUARKAN PENGGUNA: tidak boleh masuk lagi hanya dengan PIN / akun Google.
// Perangkat itu baru bisa kembali bila ditautkan lewat Scan QR yang disetujui perangkat terdaftar.
// Disimpan di Script Properties per token (maks. 50 ID terakhir).
// ------------------------------------------------------------------------------
function removedDevKey_(token) { return "REMOVED_DEV_" + normalizeToken_(token); }
function getRemovedDevices_(token) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(removedDevKey_(token));
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch(e) { return []; }
}
function isDeviceRemoved_(token, deviceId) {
  if (!token || !deviceId) return false;
  return getRemovedDevices_(token).indexOf(String(deviceId)) !== -1;
}
function markDevicesRemoved_(token, ids) {
  try {
    var list = getRemovedDevices_(token);
    (ids || []).forEach(function(id) { id = String(id || ""); if (id && list.indexOf(id) === -1) list.push(id); });
    if (list.length > 50) list = list.slice(list.length - 50);
    PropertiesService.getScriptProperties().setProperty(removedDevKey_(token), JSON.stringify(list));
  } catch(e) {}
}
function unmarkDeviceRemoved_(token, deviceId) {
  try {
    var list = getRemovedDevices_(token);
    var idx = list.indexOf(String(deviceId || ""));
    if (idx === -1) return;
    list.splice(idx, 1);
    PropertiesService.getScriptProperties().setProperty(removedDevKey_(token), JSON.stringify(list));
  } catch(e) {}
}
var REMOVED_DEVICE_MESSAGE = "Perangkat ini sudah DIKELUARKAN dari lisensi, jadi tidak bisa masuk lagi dengan PIN. Untuk memakainya kembali, tautkan lewat Scan QR dari perangkat yang masih terdaftar (Setup > Akun & Lisensi).";

function deactivateClientDevice(params) {
  var tokenInput = (params.token || "").trim().toUpperCase();
  var targetDeviceId = (params.targetDeviceId || params.deviceId || "").trim();
  var currentDeviceId = (params.currentDeviceId || params.requesterDeviceId || "").trim();

  // Akun demo dipakai bersama: satu pengguna tidak boleh mengeluarkan semua perangkat demo lain
  if (targetDeviceId === "ALL_OTHERS" && tokensMatch_(tokenInput, DEMO_TOKEN)) {
    return { success: false, message: "Akun demo tidak bisa mengeluarkan perangkat lain." };
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { success: false, message: "Token tidak ditemukan" };
  var colMap = getTokenColumnIndexes(data[0]);

  for (var i = 1; i < data.length; i++) {
    if (tokensMatch_(data[i][colMap.token], tokenInput)) {
      var buyerName = data[i][colMap.buyerName];
      var rawDevices = data[i][colMap.usedDevices];
      var devices = parseDevices_(rawDevices);

      // Yang meminta harus perangkat terdaftar. Tanpa currentDeviceId, hanya boleh melepas dirinya sendiri.
      var requesterId = currentDeviceId || (targetDeviceId !== "ALL_OTHERS" ? targetDeviceId : "");
      if (!requesterId || deviceIndex_(devices, requesterId) === -1) {
        logEvent("DEVICE_REMOVE_REJECTED", tokenInput, buyerName, requesterId || "-", "-", "Ditolak: permintaan lepas perangkat dari perangkat tidak terdaftar");
        return { success: false, message: "Perangkat ini tidak terdaftar di lisensi, jadi tidak bisa mengelola perangkat lain." };
      }

      var updated = [];
      var removedName = targetDeviceId;

      if (targetDeviceId === "ALL_OTHERS") {
        updated = devices.filter(function(d) { return d.deviceId === currentDeviceId; });
        markDevicesRemoved_(tokenInput, devices.filter(function(d) { return d.deviceId !== currentDeviceId; }).map(function(d) { return d.deviceId; }));
        logEvent("ALL_OTHER_DEVICES_DEACTIVATED", tokenInput, buyerName, currentDeviceId, "-", "Pengguna mengeluarkan semua perangkat lain");
      } else {
        // Perangkat lain yang dikeluarkan tidak boleh masuk lagi dengan PIN (keluar dari perangkat sendiri tetap boleh masuk lagi)
        if (targetDeviceId !== requesterId) markDevicesRemoved_(tokenInput, [targetDeviceId]);
        for (var k = 0; k < devices.length; k++) {
          if (devices[k].deviceId === targetDeviceId) {
            removedName = devices[k].deviceName || targetDeviceId;
            break;
          }
        }
        updated = devices.filter(function(d) { return d.deviceId !== targetDeviceId; });
        logEvent("DEVICE_DEACTIVATED", tokenInput, buyerName, targetDeviceId, removedName, "Perangkat dilepas oleh pengguna");
      }

      sheet.getRange(i + 1, colMap.deviceCount + 1).setValue(updated.length);
      sheet.getRange(i + 1, colMap.usedDevices + 1).setValue(JSON.stringify(updated));

      return { 
        success: true, 
        message: (targetDeviceId === "ALL_OTHERS") ? "Semua perangkat lain berhasil dikeluarkan." : "Perangkat '" + removedName + "' berhasil dikeluarkan.",
        deviceCount: updated.length
      };
    }
  }

  return { success: false, message: "Token tidak ditemukan" };
}

// ==============================================================================
// LOGIKA DEVELOPER / ADMIN DASHBOARD
// ==============================================================================

function getActiveAdminPassword() {
  try {
    var storedPass = PropertiesService.getScriptProperties().getProperty("DEV_PORTAL_PASSWORD");
    if (storedPass && String(storedPass).trim()) {
      return String(storedPass).trim();
    }
  } catch(e) {}
  return ""; // belum diatur -> semua aksi admin ditolak
}

function checkAdminAuth(password) {
  // Kunci sementara setelah terlalu banyak percobaan salah (anti tebak password)
  if (isRateLimited_("ADMIN", "GLOBAL", 10)) return false;
  var effectivePass = getActiveAdminPassword();
  if (!effectivePass || effectivePass === LEGACY_DEFAULT_ADMIN_PASSWORD) return false;
  var ok = !!(password && String(password).trim() === effectivePass);
  // "TEST_VERSION_CHECK" = cek versi dari Dashboard, bukan tebakan password
  if (!ok && password && password !== "TEST_VERSION_CHECK") registerFailure_("ADMIN", "GLOBAL", 900);
  return ok;
}

function adminChangePassword(params) {
  if (!checkAdminAuth(params.adminPassword)) {
    return { success: false, message: "Kata sandi lama yang Anda masukkan salah!" };
  }
  var newPass = (params.newAdminPassword || "").trim();
  if (!newPass || newPass.length < 10) {
    return { success: false, message: "Kata sandi baru minimal 10 karakter." };
  }
  if (newPass === LEGACY_DEFAULT_ADMIN_PASSWORD) {
    return { success: false, message: "Jangan memakai kata sandi bawaan yang tercantum di kode publik." };
  }
  PropertiesService.getScriptProperties().setProperty("DEV_PORTAL_PASSWORD", newPass);
  logEvent("ADMIN_PASSWORD_CHANGED", "-", "Developer", "-", "-", "Password Developer Portal berhasil diperbarui.");
  return { success: true, message: "Kata sandi Dev Portal berhasil diperbarui!" };
}

function adminLogin(params) {
  if (isRateLimited_("ADMIN", "GLOBAL", 10)) {
    return { success: false, message: "Terlalu banyak percobaan password salah. Login dikunci 15 menit." };
  }
  if (!checkAdminAuth(params.adminPassword)) {
    return { success: false, message: "Kata sandi Developer salah!" };
  }
  return { success: true, message: "Login berhasil" };
}

function adminGetData(params) {
  if (!checkAdminAuth(params.adminPassword)) {
    return { success: false, message: "Akses ditolak." };
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    return {
      success: true,
      stats: { totalTokens: 0, activeTokens: 0, blockedTokens: 0, totalDevicesActive: 0, totalPinChanged: 0, totalUsingToken: 0, totalUnclaimed: 0 },
      tokens: [],
      recentLogs: []
    };
  }
  var colMap = getTokenColumnIndexes(data[0]);

  var tokensList = [];
  var totalDevicesActive = 0;
  var totalActiveTokens = 0;
  var totalBlockedTokens = 0;
  var totalPinChanged = 0;
  var totalUsingToken = 0;
  var totalUnclaimed = 0;

  for (var i = 1; i < data.length; i++) {
    var rawDev = data[i][colMap.usedDevices];
    var parsedDev = [];
    try { parsedDev = rawDev ? JSON.parse(rawDev) : []; } catch(e) {}

    var st = String(data[i][colMap.status] || "ACTIVE").trim().toUpperCase();
    var pinSt = String(data[i][colMap.pinStatus] || "UNCLAIMED").trim().toUpperCase();
    var storedPersonalPin = String(data[i][colMap.personalPin] || "").trim();

    // Normalisasi cerdas: jika 0 perangkat, mustahil PIN_CHANGED
    var effectivePinStatus = "UNCLAIMED";
    if (parsedDev.length === 0) {
      effectivePinStatus = (pinSt === "USING_TOKEN" ? "USING_TOKEN" : "UNCLAIMED");
    } else {
      var isPinChanged = (pinSt === "PIN_CHANGED") || hasStoredPin_(storedPersonalPin);
      effectivePinStatus = isPinChanged ? "PIN_CHANGED" : "USING_TOKEN";
    }

    if (st === "ACTIVE") totalActiveTokens++;
    else if (st === "BLOCKED") totalBlockedTokens++;

    if (effectivePinStatus === "PIN_CHANGED") totalPinChanged++;
    else if (effectivePinStatus === "USING_TOKEN") totalUsingToken++;
    else totalUnclaimed++;

    totalDevicesActive += parsedDev.length;

    var createdVal = String(data[i][colMap.createdAt] || "");
    if (!createdVal || ["USING_TOKEN", "PIN_CHANGED", "UNCLAIMED"].includes(createdVal.toUpperCase())) {
      createdVal = "-";
    }
    var notesVal = String(data[i][colMap.notes] || "");

    tokensList.push({
      token: String(data[i][colMap.token] || ''),
      isOwner: isOwnerToken_(data[i][colMap.token]),
      buyerName: String(data[i][colMap.buyerName] || ''),
      buyerContact: String(data[i][colMap.buyerContact] || ''),
      buyerEmail: (colMap.buyerEmail !== undefined && data[i][colMap.buyerEmail]) ? String(data[i][colMap.buyerEmail]).trim() : '',
      spreadsheetId: (colMap.spreadsheetId !== undefined && data[i][colMap.spreadsheetId]) ? String(data[i][colMap.spreadsheetId]).trim() : '',
      cloudUrl: (colMap.cloudUrl !== undefined && data[i][colMap.cloudUrl]) ? stripCloudKey_(data[i][colMap.cloudUrl]) : '',
      maxDevices: parseInt(data[i][colMap.maxDevices]) || 3,
      deviceCount: parsedDev.length,
      usedDevices: parsedDev,
      status: st,
      pinStatus: effectivePinStatus,
      createdAt: createdVal,
      notes: notesVal
    });
  }

  // 30 Log aktivitas terbaru
  var logSheet = ss.getSheetByName(SHEET_LOGS);
  var logData = logSheet.getDataRange().getValues();
  var recentLogs = [];
  for (var j = Math.max(1, logData.length - 35); j < logData.length; j++) {
    recentLogs.unshift({
      timestamp: String(logData[j][0] || ''),
      event: String(logData[j][1] || ''),
      token: String(logData[j][2] || ''),
      buyerName: String(logData[j][3] || ''),
      deviceId: String(logData[j][4] || ''),
      deviceName: String(logData[j][5] || ''),
      details: String(logData[j][6] || '')
    });
  }

  // Data Pemesanan (Orders)
  var ordersList = [];
  try {
    var ordersSheet = ss.getSheetByName(SHEET_ORDERS);
    if (ordersSheet) {
      var ordData = ordersSheet.getDataRange().getValues();
      if (ordData && ordData.length > 1) {
        var ordColMap = getOrderColumnIndexes(ordData[0]);
        for (var o = 1; o < ordData.length; o++) {
          if (!ordData[o][0]) continue;
          var noteStr = String(ordData[o][ordColMap.notes] || '');
          var mU = noteStr.match(/Kode Unik:\s*([0-9]{1,4})/i);
          var mSeq = noteStr.match(/Urutan\s*#?([0-9]+)/i);
          var itemSeq = mSeq ? parseInt(mSeq[1], 10) : o;
          var uCode = mU ? mU[1] : String(((itemSeq - 1) % 99) + 1);
          if (uCode && uCode.length === 1) uCode = "0" + uCode;

          ordersList.unshift({
            orderId: String(ordData[o][ordColMap.orderId] || ''),
            orderSeq: itemSeq,
            uniqueCode: uCode,
            timestamp: String(ordData[o][ordColMap.timestamp] || ''),
            buyerName: String(ordData[o][ordColMap.buyerName] || ''),
            whatsapp: String(ordData[o][ordColMap.whatsapp] || ''),
            email: String(ordData[o][ordColMap.email] || ''),
            package: String(ordData[o][ordColMap.package] || ''),
            maxDevices: parseInt(ordData[o][ordColMap.maxDevices]) || 1,
            price: String(ordData[o][ordColMap.price] || ''),
            paymentMethod: String(ordData[o][ordColMap.paymentMethod] || ''),
            paymentProof: (ordColMap.paymentProof !== undefined && ordData[o][ordColMap.paymentProof]) ? String(ordData[o][ordColMap.paymentProof] || '') : '',
            status: String(ordData[o][ordColMap.status] || 'PENDING').trim().toUpperCase(),
            token: String(ordData[o][ordColMap.token] || ''),
            notes: noteStr,
            updatedAt: String(ordData[o][ordColMap.updatedAt] || '')
          });
        }
      }
    }
  } catch(ordErr) {
    Logger.log("Error membaca sheet Orders: " + ordErr);
  }

  return {
    success: true,
    stats: {
      totalTokens: tokensList.length,
      activeTokens: totalActiveTokens,
      blockedTokens: totalBlockedTokens,
      totalDevicesActive: totalDevicesActive,
      totalPinChanged: totalPinChanged, // Sudah Ganti PIN (Token Hangus)
      totalUsingToken: totalUsingToken, // Masih Pakai Token (1 Device)
      totalUnclaimed: totalUnclaimed    // Belum dipakai
    },
    tokens: tokensList,
    orders: ordersList,
    recentLogs: recentLogs,
    salesSettings: (function() { var s = getStoredSalesSettings(); s.fonnteToken = ""; s.fonnteAutoSend = false; return s; })()
  };
}

function adminGenerateToken(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };

  var buyerName = (params.buyerName || "").trim();
  var buyerContact = (params.buyerContact || "").trim();
  var maxDevices = parseInt(params.maxDevices) || 2;
  var notes = (params.notes || "Order Web Resmi").trim();

  if (!buyerName) return { success: false, message: "Nama pembeli wajib diisi." };

  var newToken = (params.customToken || "").trim().toUpperCase();
  if (newToken && !/^[A-Z0-9-]{6,40}$/.test(newToken)) {
    return { success: false, message: "Format token khusus tidak valid (hanya huruf besar, angka, dan tanda -)." };
  }
  if (!newToken) newToken = generateRandomToken();

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  // Cegah token ganda (token khusus yang sudah ada tidak boleh dibuat lagi)
  var existingTok = sheet.getDataRange().getValues();
  if (existingTok && existingTok.length > 1) {
    var tCol = getTokenColumnIndexes(existingTok[0]).token;
    for (var et = 1; et < existingTok.length; et++) {
      if (tokensMatch_(existingTok[et][tCol], newToken)) {
        return { success: false, message: "Token " + newToken + " sudah ada di database." };
      }
    }
  }

  sheet.appendRow(safeRow_([
    newToken,
    buyerName,
    buyerContact,
    maxDevices,
    0, // device count awal
    JSON.stringify([]), // used devices kosong
    "ACTIVE",
    "UNCLAIMED", // pin status awal
    "", // personal pin belum ada
    nowStr,
    notes,
    stripCloudKey_(params.cloudUrl),
    params.buyerEmail || "",
    params.spreadsheetId || ""
  ]));

  logEvent("TOKEN_ORDER_CREATED", newToken, buyerName, "-", "-", "Token order baru diterbitkan. Kuota: " + maxDevices + " devices.");

  var waMessage = 
    "Halo kak *" + buyerName + "*,\n\n" +
    "Terima kasih telah memesan aplikasi resmi *KEUANGANKU PRO v1.0*! 🎉\n\n" +
    "Berikut adalah detail lisensi resmi Anda:\n" +
    "🔑 *Token Akses:* `" + newToken + "`\n" +
    "📱 *Kuota Perangkat:* Maksimal " + maxDevices + " Perangkat (HP / Laptop)\n\n" +
    "🌐 *Link Aplikasi:*\n" +
    "https://sambarangpro.github.io/keuanganku/\n\n" +
    "📖 *Panduan Penggunaan Lengkap Bergambar:*\n" +
    "https://sambarangpro.github.io/keuanganku/poster-panduan-penggunaan.html\n\n" +
    "*(Seluruh petunjuk aktivasi, cara pasang di layar utama HP/laptop, setup Google Sheets Cloud, hingga multi-perangkat sudah lengkap beserta gambar & kode skrip di link panduan di atas)*\n\n" +
    "Selamat mengelola keuangan dengan rapi & berkah! 🙏✨\n" +
    "_Copyright © 2026 Sambarang Production_";

  return {
    success: true,
    message: "Token order berhasil dibuat!",
    token: {
      token: newToken,
      buyerName: buyerName,
      buyerContact: buyerContact,
      maxDevices: maxDevices,
      deviceCount: 0,
      status: "ACTIVE",
      pinStatus: "UNCLAIMED",
      createdAt: nowStr,
      notes: notes,
      waMessage: waMessage
    }
  };
}

/**
 * Developer Mengaktifkan Kembali Token / Reset PIN
 * Berguna jika pembeli lupa PIN pribadinya dan minta reset ke token bawaan
 */
function adminReactivateToken(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };

  var token = (params.token || "").trim().toUpperCase();
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { success: false, message: "Token tidak ditemukan" };
  var colMap = getTokenColumnIndexes(data[0]);

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colMap.token]).trim().toUpperCase() === token) {
      sheet.getRange(i + 1, colMap.deviceCount + 1).setValue(0); // device count reset
      sheet.getRange(i + 1, colMap.usedDevices + 1).setValue(JSON.stringify([])); // clear devices
      sheet.getRange(i + 1, colMap.status + 1).setValue("ACTIVE");
      sheet.getRange(i + 1, colMap.pinStatus + 1).setValue("USING_TOKEN"); // Kembalikan ke token bawaan
      sheet.getRange(i + 1, colMap.personalPin + 1).setValue(""); // hapus PIN pribadi lama

      logEvent("TOKEN_REACTIVATED", token, data[i][colMap.buyerName], "-", "-", "Developer mengaktifkan kembali token & mereset perangkat.");
      return { 
        success: true, 
        message: "Token " + token + " berhasil diaktifkan kembali! Pengguna dapat menggunakannya lagi sebagai password awal." 
      };
    }
  }

  return { success: false, message: "Token tidak ditemukan" };
}

function adminResetDevices(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };
  var token = (params.token || "").trim().toUpperCase();
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { success: false, message: "Token tidak ditemukan" };
  var colMap = getTokenColumnIndexes(data[0]);

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colMap.token]).trim().toUpperCase() === token) {
      sheet.getRange(i + 1, colMap.deviceCount + 1).setValue(0);
      sheet.getRange(i + 1, colMap.usedDevices + 1).setValue(JSON.stringify([]));
      logEvent("DEVICES_RESET", token, data[i][colMap.buyerName], "-", "-", "Slot perangkat direset oleh Developer.");
      return { success: true, message: "Slot perangkat untuk " + token + " berhasil direset." };
    }
  }
  return { success: false, message: "Token tidak ditemukan" };
}

function adminDeactivateDevice(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };
  var token = (params.token || "").trim().toUpperCase();
  var targetDeviceId = (params.targetDeviceId || params.deviceId || "").trim();

  if (!token || !targetDeviceId) return { success: false, message: "Parameter token atau deviceId tidak lengkap." };

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { success: false, message: "Token tidak ditemukan" };
  var colMap = getTokenColumnIndexes(data[0]);

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colMap.token]).trim().toUpperCase() === token) {
      var buyerName = data[i][colMap.buyerName];
      var rawDevices = data[i][colMap.usedDevices];
      var devices = [];
      try { devices = rawDevices ? JSON.parse(rawDevices) : []; } catch(e) {}

      var updated = [];
      var removedName = targetDeviceId;

      for (var k = 0; k < devices.length; k++) {
        if (devices[k].deviceId === targetDeviceId) {
          removedName = devices[k].deviceName || targetDeviceId;
        } else {
          updated.push(devices[k]);
        }
      }

      sheet.getRange(i + 1, colMap.deviceCount + 1).setValue(updated.length);
      sheet.getRange(i + 1, colMap.usedDevices + 1).setValue(JSON.stringify(updated));
      logEvent("DEVICE_DEACTIVATED_BY_ADMIN", token, buyerName, targetDeviceId, removedName, "Perangkat dikeluarkan secara individual oleh Developer.");

      return { 
        success: true, 
        message: "Perangkat '" + removedName + "' berhasil dikeluarkan dari lisensi " + token + ".",
        deviceCount: updated.length,
        devices: updated
      };
    }
  }
  return { success: false, message: "Token tidak ditemukan" };
}

function adminToggleStatus(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };
  var token = (params.token || "").trim().toUpperCase();
  var newStatus = (params.status || "ACTIVE").trim().toUpperCase();

  if (newStatus !== "ACTIVE" && newStatus !== "BLOCKED") newStatus = "ACTIVE";

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { success: false, message: "Token tidak ditemukan" };
  var colMap = getTokenColumnIndexes(data[0]);

  for (var i = 1; i < data.length; i++) {
    if (tokensMatch_(data[i][colMap.token], token)) {
      sheet.getRange(i + 1, colMap.status + 1).setValue(newStatus);
      logEvent("STATUS_TOGGLED", token, data[i][colMap.buyerName], "-", "-", "Status lisensi diubah ke: " + newStatus);
      return { success: true, message: "Status token berhasil diubah menjadi " + newStatus };
    }
  }
  return { success: false, message: "Token tidak ditemukan" };
}

function adminDeleteToken(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };
  var token = (params.token || "").trim().toUpperCase();
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { success: false, message: "Token tidak ditemukan" };
  var colMap = getTokenColumnIndexes(data[0]);

  for (var i = 1; i < data.length; i++) {
    if (tokensMatch_(data[i][colMap.token], token)) {
      sheet.deleteRow(i + 1);
      logEvent("TOKEN_DELETED", token, data[i][colMap.buyerName], "-", "-", "Token dihapus permanen oleh Developer.");
      return { success: true, message: "Token berhasil dihapus." };
    }
  }
  return { success: false, message: "Token tidak ditemukan" };
}

function generateRandomToken() {
  // Acak kriptografis (UUID v4) & 12 karakter (~60 bit) agar token tidak bisa ditebak
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 karakter, tanpa huruf/angka yang mirip
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
  var out = "";
  for (var i = 0; i < 12; i++) {
    out += chars.charAt((bytes[i] & 0xff) % 32);
  }
  return "PRO-" + out.substring(0, 4) + "-" + out.substring(4, 8) + "-" + out.substring(8, 12);
}

function logEvent(event, token, buyerName, deviceId, deviceName, details) {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_LOGS);
    if (!sheet) return;
    var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    // Isi log bisa berasal dari siapa saja (mis. token palsu): batasi panjang & buang tanda < > (cegah kode tersusup)
    var clean = function(v, max) { return String(v == null ? "" : v).replace(/[<>]/g, "").substring(0, max); };
    sheet.appendRow(safeRow_([nowStr, clean(event, 60), clean(token, 40), clean(buyerName, 100), clean(deviceId, 80), clean(deviceName, 80), clean(details, 300)]));
  } catch(e) {}
}

// ============================================================
// MANAJEMEN DAFTAR PEMESANAN (ORDERS)
// ============================================================

function adminAddOrder(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };

  var buyerName = (params.buyerName || "").trim();
  var whatsapp = (params.whatsapp || "").trim();
  var email = (params.email || "").trim();
  var pkg = (params.package || "PRO Personal (1 Perangkat)").trim();
  var maxDevices = parseInt(params.maxDevices) || 1;
  var price = (params.price || "Rp 99.000").trim();
  var paymentMethod = (params.paymentMethod || "Transfer BCA").trim();
  var paymentProof = (params.paymentProof || "").trim();
  var status = (params.status || "PENDING").trim().toUpperCase();
  var notes = (params.notes || "").trim();

  if (!buyerName) return { success: false, message: "Nama pemesan wajib diisi." };

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ORDERS);
  if (!sheet) {
    initSheets();
    sheet = ss.getSheetByName(SHEET_ORDERS);
  }

  var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var salesSettings = getStoredSalesSettings();
  var orderMode = salesSettings.orderMode || "TESTING";
  var launchSeqOffset = parseInt(salesSettings.launchSeqOffset, 10) || 0;

  var lastRow = sheet.getLastRow();
  var rawSeq = Math.max(1, lastRow);
  var orderSeq = (launchSeqOffset > 0 && rawSeq >= launchSeqOffset) ? Math.max(1, rawSeq - launchSeqOffset + 1) : rawSeq;
  var computedUniqueCode = ((orderSeq - 1) % 99) + 1;
  var uniqueCode = parseInt(params.uniqueCode, 10) || computedUniqueCode;
  var uCodePadded = (uniqueCode < 10 ? "0" : "") + uniqueCode;

  // Order ID selalu dibuat server (dengan akhiran acak agar tidak bentrok)
  var dateCompact = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
  var orderId = "ORD-" + dateCompact + "-" + uCodePadded + "-" + Utilities.getUuid().substring(0, 4).toUpperCase();

  var fullNotes = notes;
  var modeTag = (orderMode === "TESTING") ? "[UJI COBA] " : "";
  if (!fullNotes.includes("Kode Unik")) {
    fullNotes = (fullNotes ? fullNotes + " | " : "") + modeTag + "Kode Unik: " + uCodePadded + " (Urutan #" + orderSeq + ")";
  }

  var tokenGenerated = "";
  if (params.autoGenerateToken && (status === "PAID" || status === "COMPLETED")) {
    tokenGenerated = generateRandomToken();
    var tokSheet = ss.getSheetByName(SHEET_TOKENS);
    tokSheet.appendRow(safeRow_([
      tokenGenerated,
      buyerName,
      whatsapp,
      maxDevices,
      0,
      JSON.stringify([]),
      "ACTIVE",
      "UNCLAIMED",
      "",
      nowStr,
      "Pemesanan " + orderId + " (" + pkg + ")"
    ]));
    status = "COMPLETED";
    logEvent("TOKEN_ORDER_CREATED", tokenGenerated, buyerName, "-", "-", "Lisensi terbit via pemesanan " + orderId);
  }

  // Dapatkan peta kolom Orders untuk kompatibilitas versi
  var lastCol = sheet.getLastColumn();
  var ordHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var ordColMap = getOrderColumnIndexes(ordHeaders);

  // Jika kolom Payment Proof tersedia di sheet Orders
  if (ordHeaders.length >= 14 || (ordColMap.paymentProof !== undefined && ordColMap.paymentProof === 9)) {
    sheet.appendRow(safeRow_([
      orderId,
      nowStr,
      buyerName,
      whatsapp,
      safeCell_(email),
      pkg,
      maxDevices,
      price,
      paymentMethod,
      paymentProof,
      status,
      tokenGenerated,
      fullNotes,
      nowStr
    ]));
  } else {
    // Fallback sheet lama 13 kolom
    sheet.appendRow(safeRow_([
      orderId,
      nowStr,
      buyerName,
      whatsapp,
      safeCell_(email),
      pkg,
      maxDevices,
      price,
      paymentMethod,
      status,
      tokenGenerated,
      fullNotes + (paymentProof ? " [Bukti: " + paymentProof + "]" : ""),
      nowStr
    ]));
  }

  logEvent("ORDER_CREATED", tokenGenerated || "-", buyerName, "-", "-", "Pemesanan baru dicatat: " + orderId + " (" + pkg + " - " + price + ")");

  return {
    success: true,
    message: "Pemesanan berhasil dicatat!",
    order: {
      orderId: orderId,
      orderSeq: orderSeq,
      uniqueCode: uCodePadded,
      timestamp: nowStr,
      buyerName: buyerName,
      whatsapp: whatsapp,
      email: email,
      package: pkg,
      maxDevices: maxDevices,
      price: price,
      paymentMethod: paymentMethod,
      paymentProof: paymentProof,
      status: status,
      token: tokenGenerated,
      notes: fullNotes,
      updatedAt: nowStr
    }
  };
}

function adminUpdateOrder(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };
  var orderId = (params.orderId || "").trim();
  if (!orderId) return { success: false, message: "Order ID wajib diberikan." };

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ORDERS);
  if (!sheet) return { success: false, message: "Sheet Orders belum ada." };

  var data = sheet.getDataRange().getValues();
  var targetRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === orderId.toUpperCase()) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow === -1) return { success: false, message: "Pesanan dengan ID " + orderId + " tidak ditemukan." };

  var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var ordColMap = getOrderColumnIndexes(data[0]);

  if (params.paymentProof !== undefined && ordColMap.paymentProof !== undefined) {
    sheet.getRange(targetRow, ordColMap.paymentProof + 1).setValue(String(params.paymentProof).trim());
  }
  if (params.status !== undefined && ordColMap.status !== undefined) {
    sheet.getRange(targetRow, ordColMap.status + 1).setValue(String(params.status).trim().toUpperCase());
  }
  if (params.notes !== undefined && ordColMap.notes !== undefined) {
    sheet.getRange(targetRow, ordColMap.notes + 1).setValue(String(params.notes).trim());
  }
  if (params.token !== undefined && ordColMap.token !== undefined) {
    sheet.getRange(targetRow, ordColMap.token + 1).setValue(String(params.token).trim());
  }
  if (ordColMap.updatedAt !== undefined) {
    sheet.getRange(targetRow, ordColMap.updatedAt + 1).setValue(nowStr);
  }

  logEvent("ORDER_UPDATED", "-", orderId, "-", "-", "Status order " + orderId + " diubah menjadi " + params.status);

  return { success: true, message: "Pemesanan berhasil diperbarui!" };
}

function adminDeleteOrder(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };
  var orderId = (params.orderId || "").trim();
  if (!orderId) return { success: false, message: "Order ID wajib diberikan." };

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ORDERS);
  if (!sheet) return { success: false, message: "Sheet Orders belum ada." };

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === orderId.toUpperCase()) {
      sheet.deleteRow(i + 1);
      logEvent("ORDER_DELETED", "-", orderId, "-", "-", "Pemesanan " + orderId + " dihapus.");
      return { success: true, message: "Pemesanan berhasil dihapus." };
    }
  }

  return { success: false, message: "Pesanan tidak ditemukan." };
}

function adminProcessOrderLicense(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };
  var orderId = (params.orderId || "").trim();
  if (!orderId) return { success: false, message: "Order ID wajib diberikan." };

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ORDERS);
  if (!sheet) return { success: false, message: "Sheet Orders belum ada." };

  var data = sheet.getDataRange().getValues();
  var targetRow = -1;
  var orderRowData = null;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === orderId.toUpperCase()) {
      targetRow = i + 1;
      orderRowData = data[i];
      break;
    }
  }

  if (targetRow === -1) return { success: false, message: "Pesanan " + orderId + " tidak ditemukan." };

  var ordColMap = getOrderColumnIndexes(data[0]);
  var buyerName = String(orderRowData[ordColMap.buyerName] || "").trim();
  var whatsapp = String(orderRowData[ordColMap.whatsapp] || "").trim();
  var email = (ordColMap.email !== undefined && orderRowData[ordColMap.email]) ? String(orderRowData[ordColMap.email]).trim() : "";
  var pkg = String(orderRowData[ordColMap.package] || "PRO Personal").trim();
  var maxDevices = parseInt(orderRowData[ordColMap.maxDevices]) || 1;
  var existingToken = String(orderRowData[ordColMap.token] || "").trim();

  var tokenToUse = existingToken;
  var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  if (!tokenToUse) {
    tokenToUse = generateRandomToken();
    var tokSheet = ss.getSheetByName(SHEET_TOKENS);
    tokSheet.appendRow(safeRow_([
      tokenToUse,
      buyerName,
      whatsapp + (email ? " | " + email : ""),
      maxDevices,
      0,
      JSON.stringify([]),
      "ACTIVE",
      "UNCLAIMED",
      "",
      nowStr,
      "Diterbitkan dari Pemesanan " + orderId + " (" + pkg + ")",
      "", // Cloud URL
      email || "", // Email Google (BYODb)
      "" // Spreadsheet ID (BYODb)
    ]));
  }

  // Update Orders sheet
  if (ordColMap.status !== undefined) sheet.getRange(targetRow, ordColMap.status + 1).setValue("COMPLETED");
  if (ordColMap.token !== undefined) sheet.getRange(targetRow, ordColMap.token + 1).setValue(tokenToUse);
  if (ordColMap.updatedAt !== undefined) sheet.getRange(targetRow, ordColMap.updatedAt + 1).setValue(nowStr);

  logEvent("ORDER_LICENSE_ISSUED", tokenToUse, buyerName, "-", "-", "Lisensi diterbitkan untuk order " + orderId);

  // Kirim Akun & Lisensi via Gmail / Email (Prioritas Utama)
  var emailSent = false;
  var emailSubject = "Aktivasi Akun & Lisensi Resmi KEUANGANKU PRO - " + tokenToUse;
  var emailBody = 
    "Kepada Yth. " + buyerName + ",\n\n" +
    "Terima kasih atas pesanan dan kepercayaan Anda menggunakan aplikasi resmi KEUANGANKU PRO!\n" +
    "Akun dan lisensi resmi Anda telah aktif dengan rincian sebagai berikut:\n\n" +
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
    "• ID PEMESANAN       : " + orderId + "\n" +
    "• KODE LISENSI RESMI : " + tokenToUse + "\n" +
    "• PAKET LISENSI      : " + pkg + "\n" +
    "• KUOTA PERANGKAT    : Maksimal " + maxDevices + " Perangkat (HP / Laptop / PC)\n" +
    "• STATUS LISENSI     : AKTIF (Akses Penuh / Lifetime)\n" +
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
    "LANGKAH MUDAH AKTIVASI:\n" +
    "1. Buka aplikasi Keuanganku PRO di browser HP atau Laptop:\n" +
    "   https://sambarangpro.github.io/keuanganku/\n\n" +
    "2. Masukkan Kode Lisensi di atas (" + tokenToUse + ") pada kolom Token Pembelian, lalu klik AKTIVASI SEKARANG.\n\n" +
    "3. Panduan Penggunaan Lengkap Bergambar & Setup Cloud:\n" +
    "   https://sambarangpro.github.io/keuanganku/poster-panduan-penggunaan.html\n\n" +
    "Simpan email ini dengan baik sebagai bukti kepemilikan lisensi resmi Anda.\n" +
    "Jika membutuhkan bantuan teknis atau konsultasi, Anda dapat langsung membalas email ini.\n\n" +
    "Selamat mengelola keuangan pribadi & usaha dengan rapi, akurat, dan berkah! 🙏✨\n\n" +
    "Salam hormat,\n" +
    "Tim Official KEUANGANKU PRO\n" +
    "Email: keuangankupro@gmail.com\n" +
    "Copyright © 2026 Sambarang Production";

  if (email && email.indexOf("@") !== -1) {
    try {
      MailApp.sendEmail({
        to: email,
        subject: emailSubject,
        body: emailBody
      });
      emailSent = true;
      logEvent("LICENSE_EMAIL_SENT", tokenToUse, buyerName, "-", "-", "Email akun lisensi terkirim ke " + email);
    } catch(errMail) {
      logEvent("LICENSE_EMAIL_FAILED", tokenToUse, buyerName, "-", "-", "Gagal kirim email: " + errMail.toString());
    }
  }

  var waMessage = 
    "Halo kak *" + buyerName + "*,\n\n" +
    "Terima kasih atas pemesanan aplikasi resmi *Keuanganku PRO*! 🎉🙏\n\n" +
    "Rincian akun & lisensi resmi Anda telah kami kirimkan ke Gmail / Email Anda (" + (email || '-') + ").\n\n" +
    "Berikut adalah ringkasan lisensi Anda:\n" +
    "📦 *Paket:* " + pkg + "\n" +
    "🔑 *Kode Token Lisensi:* `" + tokenToUse + "`\n" +
    "📱 *Kuota Perangkat:* Maksimal " + maxDevices + " Perangkat\n" +
    "🆔 *ID Pemesanan:* " + orderId + "\n\n" +
    "🌐 *Link Aplikasi:*\n" +
    "https://sambarangpro.github.io/keuanganku/\n\n" +
    "📖 *Panduan Penggunaan Lengkap:*\n" +
    "https://sambarangpro.github.io/keuanganku/poster-panduan-penggunaan.html\n\n" +
    "Selamat menggunakan Keuanganku PRO untuk mengelola keuangan Anda lebih rapi dan berkah! ✨\n\n" +
    "_Sambarang Production_";

  return {
    success: true,
    message: emailSent ? ("Lisensi berhasil diterbitkan & email akun otomatis terkirim ke " + email) : "Lisensi berhasil diterbitkan!",
    token: tokenToUse,
    orderId: orderId,
    email: email,
    emailSent: emailSent,
    emailSubject: emailSubject,
    emailBody: emailBody,
    waMessage: waMessage
  };
}

// ============================================================
// MANAJEMEN KATALOG PAKET, VOUCHER & PENJUALAN
// ============================================================

function getDefaultSalesSettings() {
  return {
    orderMode: "TESTING", // "TESTING" (v0.1) | "LIVE" (v1.0)
    launchSeqOffset: 0,
    sellerWhatsApp: "087788197916",
    fonnteToken: "",
    fonnteAutoSend: false,
    orderFormUrl: "https://sambarangpro.github.io/keuanganku/pesan.html",
    packages: [
      { id: "pkg-personal", name: "PRO Personal (3 Perangkat)", devices: 3, price: "Rp 79.000", priceNum: 79000, description: "Ideal untuk 1 orang dengan ekosistem lengkap: HP, Laptop, dan Tablet bersamaan. Akses seumur hidup.", popular: true },
      { id: "pkg-multi", name: "PRO Keluarga / Pasutri (5 Perangkat)", devices: 5, price: "Rp 149.000", priceNum: 149000, description: "Sinkronisasi otomatis HP Suami, Istri, dan Laptop keluarga. Catatan pos belanja rumah tangga transparan.", popular: false },
      { id: "pkg-bisnis", name: "PRO Bisnis UMKM (8 Perangkat)", devices: 8, price: "Rp 249.000", priceNum: 249000, description: "Solusi operasional toko & kantor kecil (Owner, Kasir, Admin, Gudang) + akses kalkulator usaha lengkap.", popular: false },
      { id: "pkg-master", name: "PRO Master / Multi-Cabang (12 Perangkat)", devices: 12, price: "Rp 399.000", priceNum: 399000, description: "Kapasitas besar hingga 12 perangkat untuk profesional, konsultan, atau multi-cabang usaha.", popular: false }
    ],
    vouchers: [
      { code: "PROMOLAUNCHING", type: "percent", value: 30, minPrice: 0, targetPackage: "ALL", maxUses: 0, usedCount: 0, status: "ACTIVE", description: "Diskon Peluncuran 30% Hingga Desember" },
      { code: "UJICOBA-PRO", type: "percent", value: 100, minPrice: 0, targetPackage: "ALL", maxUses: 3, usedCount: 0, status: "ACTIVE", description: "Token Lisensi Pengguna Perdana Multi-Device (Akses Seumur Hidup - Kuota 3 Pengguna)" },
      { code: "BERKAH30", type: "fixed", value: 30000, minPrice: 99000, targetPackage: "ALL", maxUses: 50, usedCount: 0, status: "ACTIVE", description: "Diskon Spesial Berkah Rp 30.000" },
      { code: "PROMOAKBAR", type: "percent", value: 20, minPrice: 99000, targetPackage: "pkg-multi", maxUses: 100, usedCount: 0, status: "ACTIVE", description: "Diskon Peluncuran 20% Khusus Multi-Device" }
    ],
    paymentAccounts: [
      { bank: "Bank Syariah Indonesia (BSI)", accountNo: "7177946448", accountName: "Muh Akbar", notes: "Rekening Utama • Konfirmasi Cepat" },
      { bank: "Bank Jago (Jago Syariah)", accountNo: "504172135812", accountName: "Muh Akbar", notes: "Transfer Bebas Biaya Admin" },
      { bank: "GoPay", accountNo: "087788197916", accountName: "Muh Akbar", notes: "Transfer E-Wallet Instant" },
      { bank: "DANA", accountNo: "087788197916", accountName: "Muh Akbar", notes: "Transfer E-Wallet Instant" },
      { bank: "OVO", accountNo: "087788197916", accountName: "Muh Akbar", notes: "Transfer E-Wallet Instant" }
    ]
  };
}

function getStoredSalesSettings() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty("KEUANGANKU_SALES_SETTINGS");
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.packages) && parsed.packages.length > 0) {
        // Auto-heal dummy data jika script properties masih menyimpan dummy BCA / 123456789
        if (!parsed.sellerWhatsApp || parsed.sellerWhatsApp.includes("123456789")) {
          parsed.sellerWhatsApp = "087788197916";
        }
        // Auto-heal paket lama: jika paket personal masih 1 device, upgrade ke struktur baru (min 3 devices)
        var pPersonal = parsed.packages.find(function(p) { return p.id === 'pkg-personal'; });
        if (!pPersonal || pPersonal.devices < 3) {
          parsed.packages = getDefaultSalesSettings().packages;
          try {
            PropertiesService.getScriptProperties().setProperty("KEUANGANKU_SALES_SETTINGS", JSON.stringify(parsed));
          } catch(e) {}
        }
        if (Array.isArray(parsed.paymentAccounts)) {
          var hasDummy = parsed.paymentAccounts.some(function(acc) {
            return acc.accountNo === "1234567890" || acc.accountNo === "08123456789" || (acc.bank && acc.bank.indexOf("Transfer BCA") !== -1);
          });
          if (hasDummy || parsed.paymentAccounts.length === 0) {
            parsed.paymentAccounts = getDefaultSalesSettings().paymentAccounts;
          }
        }
        return parsed;
      }
    }
  } catch(e) {}
  return getDefaultSalesSettings();
}

function getPublicCatalog(params) {
  var settings = getStoredSalesSettings();
  var orderMode = settings.orderMode || "TESTING";
  var launchSeqOffset = parseInt(settings.launchSeqOffset, 10) || 0;

  // Kode voucher TIDAK lagi dikirim ke halaman publik (dulu siapa pun bisa melihat semua kode,
  // termasuk voucher gratis). Pembeli mengetik kodenya, lalu server memeriksa lewat "check_voucher".
  var hasVouchers = (settings.vouchers || []).some(function(v) {
    return String(v.status || "ACTIVE").toUpperCase() === "ACTIVE";
  });

  // Hitung nomor urut antrean orderan berikutnya & kode unik 2 digit
  var nextOrderSeq = 1;
  try {
    var ss = getSpreadsheet();
    if (ss) {
      var sheet = ss.getSheetByName(SHEET_ORDERS);
      if (sheet) {
        var lastRow = sheet.getLastRow();
        var rawSeq = Math.max(1, lastRow); // Baris 1 header, baris 2 order #1
        if (launchSeqOffset > 0 && rawSeq >= launchSeqOffset) {
          nextOrderSeq = Math.max(1, rawSeq - launchSeqOffset + 1);
        } else {
          nextOrderSeq = rawSeq;
        }
      }
    }
  } catch(e) {}
  var nextUniqueCode = ((nextOrderSeq - 1) % 99) + 1;

  return {
    success: true,
    orderMode: orderMode,
    launchSeqOffset: launchSeqOffset,
    appVersion: (orderMode === "LIVE") ? "v1.0" : "v0.1",
    packages: settings.packages || [],
    vouchers: [],
    hasVouchers: hasVouchers,
    paymentAccounts: settings.paymentAccounts || [],
    sellerWhatsApp: settings.sellerWhatsApp || "",
    orderFormUrl: settings.orderFormUrl || "",
    nextOrderSeq: nextOrderSeq,
    nextUniqueCode: nextUniqueCode
  };
}

/**
 * JALANKAN SEKALI DARI EDITOR: jadikan semua foto bukti transfer lama PRIVAT
 * (dulu dibagikan "siapa saja yang memiliki link").
 */
function privatkanBuktiTransfer() {
  var n = 0;
  var folders = DriveApp.getFoldersByName("Bukti_Transfer_Keuanganku");
  while (folders.hasNext()) {
    var files = folders.next().getFiles();
    while (files.hasNext()) {
      var f = files.next();
      try { f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); n++; } catch(e) {}
    }
  }
  Logger.log("Selesai: " + n + " foto bukti transfer kini privat.");
}

/** Cari voucher yang berlaku untuk paket tertentu. Mengembalikan {voucher} atau {reason}. */
function findApplicableVoucher_(settings, code, pkgObj, basePrice) {
  code = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!code) return { reason: "EMPTY" };
  var found = null;
  (settings.vouchers || []).forEach(function(v) {
    if (!found && String(v.code || "").trim().toUpperCase() === code) found = v;
  });
  if (!found) return { reason: "NOT_FOUND" };
  if (String(found.status || "ACTIVE").toUpperCase() !== "ACTIVE") return { reason: "INACTIVE" };
  var vMax = Number(found.maxUses) || 0;
  if (vMax > 0 && (Number(found.usedCount) || 0) >= vMax) return { reason: "QUOTA" };
  if (pkgObj) {
    if ((Number(found.minPrice) || 0) > basePrice) return { reason: "MIN_PRICE", voucher: found };
    var tgt = found.targetPackage || "ALL";
    if (tgt !== "ALL" && tgt !== pkgObj.id && tgt !== pkgObj.name) return { reason: "PACKAGE", voucher: found };
  }
  return { voucher: found };
}

/** Form publik: periksa SATU kode voucher (dibatasi agar kode tidak bisa ditebak beruntun). */
function checkVoucher(params) {
  var code = String(params.code || "").trim().toUpperCase().replace(/\s+/g, "").substring(0, 40);
  if (!code) return { success: false, message: "Silakan ketikkan kode voucher." };
  if (isRateLimited_("VOUCHER", "GLOBAL", 40)) {
    return { success: false, message: "Terlalu banyak percobaan kode. Silakan coba lagi 15 menit lagi." };
  }
  var settings = getStoredSalesSettings();
  var pkgObj = null;
  (settings.packages || []).forEach(function(p) {
    if (!pkgObj && (p.id === params.packageId || p.name === params.package)) pkgObj = p;
  });
  if (!pkgObj) return { success: false, message: "Silakan pilih paket lisensi terlebih dahulu." };
  var basePrice = Number(pkgObj.priceNum) || parseInt(String(pkgObj.price || "").replace(/[^0-9]/g, ""), 10) || 0;
  var r = findApplicableVoucher_(settings, code, pkgObj, basePrice);
  if (!r.voucher || r.reason === "INACTIVE" || r.reason === "QUOTA" || r.reason === "NOT_FOUND") {
    registerFailure_("VOUCHER", "GLOBAL", 900);
    var msg = (r.reason === "QUOTA") ? "Maaf, kuota voucher \"" + code + "\" sudah habis."
      : (r.reason === "INACTIVE") ? "Voucher \"" + code + "\" sedang tidak aktif."
      : "Kode voucher \"" + code + "\" tidak ditemukan. Pastikan kode sesuai.";
    return { success: false, message: msg };
  }
  var v = r.voucher;
  if (r.reason === "MIN_PRICE") {
    return { success: false, message: "Voucher ini hanya berlaku untuk pembelian minimal Rp " + String(Number(v.minPrice) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "." };
  }
  if (r.reason === "PACKAGE") {
    var reqPkg = null;
    (settings.packages || []).forEach(function(p) { if (!reqPkg && (p.id === v.targetPackage || p.name === v.targetPackage)) reqPkg = p; });
    return { success: false, message: "Voucher ini hanya berlaku untuk paket \"" + (reqPkg ? reqPkg.name : v.targetPackage) + "\"." };
  }
  var maxUses = Number(v.maxUses) || 0;
  return {
    success: true,
    voucher: {
      code: String(v.code || "").toUpperCase(),
      type: v.type || "fixed",
      value: Number(v.value) || 0,
      minPrice: Number(v.minPrice) || 0,
      targetPackage: v.targetPackage || "ALL",
      description: v.description || "",
      remaining: maxUses > 0 ? Math.max(0, maxUses - (Number(v.usedCount) || 0)) : -1
    }
  };
}

/**
 * Kode unik 2 digit untuk nominal transfer. Dimulai dari nomor urut pesanan, lalu digeser
 * bila sudah dipakai pesanan lain yang MASIH MENUNGGU pembayaran dengan nominal yang sama,
 * agar dua pembeli tidak pernah diminta transfer dengan angka persis sama.
 */
function pickUniqueCode_(sheet, priceAfterDiscount, startCode) {
  if (priceAfterDiscount <= 0) return startCode;
  var taken = {};
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var cm = getOrderColumnIndexes(headers);
      var from = Math.max(2, lastRow - 400);
      var rows = sheet.getRange(from, 1, lastRow - from + 1, sheet.getLastColumn()).getValues();
      rows.forEach(function(r) {
        var st = String(r[cm.status] || "").trim().toUpperCase();
        if (st !== "PENDING" && st !== "MENUNGGU") return;
        var total = parseInt(String(r[cm.price] || "").replace(/[^0-9]/g, ""), 10) || 0;
        var diff = total - priceAfterDiscount;
        if (diff >= 1 && diff <= 99) taken[diff] = true;
      });
    }
  } catch(e) {}
  for (var k = 0; k < 99; k++) {
    var c = ((startCode - 1 + k) % 99) + 1;
    if (!taken[c]) return c;
  }
  return startCode;
}

function saveProofImageToDrive(base64Data, orderId) {
  try {
    var parts = base64Data.split(",");
    if (parts.length < 2) return base64Data;
    var mimeMatch = parts[0].match(/:(.*?);/);
    var mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
    var decoded = Utilities.base64Decode(parts[1]);
    var ext = (mimeType.indexOf("png") !== -1) ? ".png" : (mimeType.indexOf("webp") !== -1 ? ".webp" : ".jpg");
    var blob = Utilities.newBlob(decoded, mimeType, "Bukti_Transfer_" + orderId + ext);
    
    var folderName = "Bukti_Transfer_Keuanganku";
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    
    var file = folder.createFile(blob);
    // Foto bukti transfer PRIVAT: hanya pemilik Google Drive (admin) yang bisa membukanya.
    // (Dulu siapa pun yang memegang tautannya bisa melihat foto struk & data rekening pembeli.)
    return file.getUrl();
  } catch(e) {
    return "[Foto Bukti: " + orderId + "]";
  }
}

function submitPublicOrder(params) {
  var buyerName = String(params.buyerName || "").trim().substring(0, 100);
  var whatsapp = String(params.whatsapp || "").trim().substring(0, 30);
  var email = String(params.email || "").trim().substring(0, 120);
  var pkgInput = String(params.package || "").trim();
  var paymentMethod = String(params.paymentMethod || "Bank Syariah Indonesia (BSI)").trim().substring(0, 100);
  var paymentProof = String(params.paymentProof || "").trim();
  var voucherCode = String(params.voucherCode || "").trim().toUpperCase().substring(0, 40);
  var notes = String(params.notes || "").trim().substring(0, 500);

  if (!buyerName) return { success: false, message: "Nama pemesan wajib diisi." };
  if (!whatsapp) return { success: false, message: "Nomor WhatsApp aktif wajib diisi." };

  // ---- Anti-spam form publik ----
  // (a) Kolom jebakan tersembunyi: manusia tidak mengisinya, robot pengisi form biasanya mengisi.
  if (String(params.website || "").trim()) {
    return { success: false, message: "Pesanan tidak dapat diproses." };
  }
  // (b) Batas jumlah pesanan: per nomor WhatsApp (5/jam) dan seluruh form (30/10 menit).
  var waKey = whatsapp.replace(/[^0-9]/g, "").slice(-12) || "NA";
  if (isRateLimited_("ORDER_WA", waKey, 5) || isRateLimited_("ORDER", "GLOBAL", 30)) {
    return { success: false, message: "Terlalu banyak pesanan dalam waktu singkat. Silakan coba lagi nanti atau hubungi admin via WhatsApp." };
  }
  registerFailure_("ORDER_WA", waKey, 3600);
  registerFailure_("ORDER", "GLOBAL", 600);
  if (email && !/^[^\s@|,;]+@[^\s@|,;]+\.[^\s@|,;]+$/.test(email)) {
    return { success: false, message: "Format email tidak valid." };
  }
  // Teks dari form publik disimpan sebagai teks biasa (cegah formula berbahaya di Google Sheets)
  buyerName = safeCell_(buyerName);
  whatsapp = safeCell_(whatsapp);
  notes = safeCell_(notes);
  paymentMethod = safeCell_(paymentMethod);

  // ---- Harga & kuota perangkat DIHITUNG DI SERVER dari katalog (tidak percaya kiriman form) ----
  var catalogSettings = getStoredSalesSettings();
  var pkgObj = null;
  (catalogSettings.packages || []).forEach(function(p) {
    if (!pkgObj && (p.id === params.packageId || p.name === pkgInput)) pkgObj = p;
  });
  if (!pkgObj) return { success: false, message: "Paket yang dipilih tidak dikenali. Muat ulang halaman pemesanan." };
  var pkg = pkgObj.name;
  var maxDevices = parseInt(pkgObj.devices, 10) || 3;
  var basePrice = Number(pkgObj.priceNum) || parseInt(String(pkgObj.price || "").replace(/[^0-9]/g, ""), 10) || 0;

  var appliedVoucher = null;
  if (voucherCode && !(voucherCode.indexOf("PRO-") === 0 || voucherCode.indexOf("KEU-") === 0)) {
    var vr = findApplicableVoucher_(catalogSettings, voucherCode, pkgObj, basePrice);
    if (vr.voucher && !vr.reason) appliedVoucher = vr.voucher;
    else registerFailure_("VOUCHER", "GLOBAL", 900);
  }
  var discount = 0;
  if (appliedVoucher) {
    discount = (appliedVoucher.type === "percent")
      ? Math.round(basePrice * (Number(appliedVoucher.value) || 0) / 100)
      : (Number(appliedVoucher.value) || 0);
  }
  var priceAfterDiscount = Math.max(0, basePrice - discount);
  if (voucherCode && !appliedVoucher && !(voucherCode.indexOf("PRO-") === 0 || voucherCode.indexOf("KEU-") === 0)) {
    notes = (notes ? notes + " | " : "") + "[Voucher " + voucherCode + " tidak berlaku/kuota habis]";
  }

  // Validasi foto bukti transfer: hanya gambar, maksimal ~5 MB
  if (paymentProof && paymentProof.indexOf("data:") === 0) {
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(paymentProof)) {
      return { success: false, message: "Bukti transfer harus berupa gambar (JPG/PNG/WEBP)." };
    }
    if (paymentProof.length > 7 * 1024 * 1024) {
      return { success: false, message: "Ukuran foto bukti transfer terlalu besar (maks. 5 MB)." };
    }
  } else if (paymentProof.length > 500) {
    paymentProof = paymentProof.substring(0, 500);
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_ORDERS);
  if (!sheet) {
    initSheets();
    sheet = ss.getSheetByName(SHEET_ORDERS);
  }

  var salesSettings = getStoredSalesSettings();
  var orderMode = salesSettings.orderMode || "TESTING";
  var launchSeqOffset = parseInt(salesSettings.launchSeqOffset, 10) || 0;

  var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var dateCompact = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
  var lastRow = sheet.getLastRow();
  var rawSeq = Math.max(1, lastRow);
  var orderSeq = (launchSeqOffset > 0 && rawSeq >= launchSeqOffset) ? Math.max(1, rawSeq - launchSeqOffset + 1) : rawSeq;
  var computedUniqueCode = ((orderSeq - 1) % 99) + 1;
  // Kode unik SELALU ditentukan server (tidak memakai angka kiriman form) dan tidak bentrok
  // dengan pesanan lain yang masih menunggu pembayaran dengan nominal sama.
  var uniqueCode = pickUniqueCode_(sheet, priceAfterDiscount, computedUniqueCode);
  var uniqueForPrice = (priceAfterDiscount > 0) ? uniqueCode : 0;
  var price = "Rp " + String(priceAfterDiscount + uniqueForPrice).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  var uCodePadded = (uniqueCode < 10 ? "0" : "") + uniqueCode;
  // Order ID selalu dibuat server (unik), tidak memakai kiriman form
  var orderId = "ORD-" + dateCompact + "-" + uCodePadded + "-" + Utilities.getUuid().substring(0, 4).toUpperCase();

  // Jika paymentProof berupa base64 foto struk, simpan langsung ke Google Drive
  if (paymentProof && paymentProof.indexOf("data:image/") === 0) {
    try {
      var driveFileUrl = saveProofImageToDrive(paymentProof, orderId);
      if (driveFileUrl) paymentProof = driveFileUrl;
    } catch(errDrive) {
      paymentProof = "[Foto Bukti: " + orderId + "]";
    }
  }

  var fullNotes = notes;
  var modeTag = (orderMode === "TESTING") ? "[UJI COBA] " : "";
  if (voucherCode) {
    fullNotes = (fullNotes ? fullNotes + " | " : "") + "Voucher: " + voucherCode;
    // Tambah hitungan pemakaian HANYA jika voucher benar-benar berlaku (sudah dicek di atas)
    try {
      if (appliedVoucher) {
        appliedVoucher.usedCount = (Number(appliedVoucher.usedCount) || 0) + 1;
        PropertiesService.getScriptProperties().setProperty("KEUANGANKU_SALES_SETTINGS", JSON.stringify(catalogSettings));
      }
    } catch(errVoucher) {}
  }
  // Kode unik di catatan SELALU dari server (abaikan tulisan "Kode Unik" kiriman form lama)
  fullNotes = String(fullNotes || "").replace(/\s*\|?\s*Kode Unik:[^|]*/g, "").replace(/^\s*\|\s*/, "").trim();
  fullNotes = (fullNotes ? fullNotes + " | " : "") + modeTag + "Kode Unik: " + uCodePadded + " (Urutan #" + orderSeq + ")";

  // Lisensi gratis HANYA jika harga hasil hitungan server = 0 karena voucher yang sah
  var isPioneerVoucher = !!(appliedVoucher && String(appliedVoucher.code).toUpperCase() === "UJICOBA-PRO");
  var isZeroPrice = !!(appliedVoucher && priceAfterDiscount === 0);
  var isExistingToken = (voucherCode.indexOf("PRO-") === 0 || voucherCode.indexOf("KEU-") === 0);

  var tokenGenerated = "";
  var orderStatus = "PENDING";
  var isEarlyAdopter = false;

  // 1. Cek jika pemesan memasukkan Token Lisensi yang sudah ada di DEV Database
  if (isExistingToken) {
    try {
      var tokSheet = ss.getSheetByName(SHEET_TOKENS);
      var tokData = tokSheet ? tokSheet.getDataRange().getValues() : [];
      var tokColMap = tokData.length > 0 ? getTokenColumnIndexes(tokData[0]) : null;
      if (tokColMap) {
        for (var ti = 1; ti < tokData.length; ti++) {
          var rTok = String(tokData[ti][tokColMap.token] || "").trim().toUpperCase();
          if (rTok === voucherCode || rTok.replace(/[^A-Z0-9]/g, '') === voucherCode.replace(/[^A-Z0-9]/g, '')) {
            tokenGenerated = rTok;
            var dbDevices = parseInt(tokData[ti][tokColMap.maxDevices]);
            if (dbDevices) maxDevices = dbDevices;
            break;
          }
        }
      }
      if (tokenGenerated) {
        orderStatus = "COMPLETED";
        fullNotes = (fullNotes ? fullNotes + " | " : "") + "[Token Terverifikasi Database: " + tokenGenerated + "]";
      }
    } catch(errTokLookup) {}
  }

  // 2. Jika Menggunakan Voucher Pengguna Perdana (UJICOBA-PRO / Gratis 100%)
  if (!tokenGenerated && (isPioneerVoucher || isZeroPrice)) {
    maxDevices = Math.max(maxDevices, 3);
    tokenGenerated = generateRandomToken();
    orderStatus = "COMPLETED";
    isEarlyAdopter = true;

    try {
      var tokSheet = ss.getSheetByName(SHEET_TOKENS);
      if (!tokSheet) {
        initSheets();
        tokSheet = ss.getSheetByName(SHEET_TOKENS);
      }
      tokSheet.appendRow(safeRow_([
        tokenGenerated,
        buyerName,
        whatsapp + (email ? " | " + email : ""),
        maxDevices,
        0,
        JSON.stringify([]),
        "ACTIVE",
        "USING_TOKEN",
        "",
        nowStr,
        "Pengguna Perdana (Early Adopter - Akses Lifetime) via " + orderId + " (" + pkg + ")"
      ]));

      fullNotes = (fullNotes ? fullNotes + " | " : "") + "[Pengguna Perdana Resmi - Akses Seumur Hidup]";
      logEvent("EARLY_ADOPTER_ISSUED", tokenGenerated, buyerName, "-", "-", "Lisensi resmi seumur hidup terbit untuk pengguna perdana via order " + orderId);

      // Kirim Akun & Lisensi Resmi via Gmail / Email
      if (email && email.indexOf("@") !== -1) {
        try {
          var pioneerEmailSubject = "Selamat Datang Pengguna Perdana! Aktivasi Akun & Lisensi Resmi KEUANGANKU PRO - " + tokenGenerated;
          var pioneerEmailBody = 
            "Kepada Yth. " + buyerName + ",\n\n" +
            "Selamat! Anda telah resmi terdaftar sebagai Pengguna Perdana (Early Adopter) aplikasi KEUANGANKU PRO!\n" +
            "Sebagai pengguna perdana, Anda mendapatkan Akses Penuh Resmi Seumur Hidup (Lifetime Access) untuk mengelola keuangan pribadi maupun usaha Anda.\n\n" +
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
            "• STATUS AKUN        : PENGGUNA PERDANA (AKSES SEUMUR HIDUP / LIFETIME)\n" +
            "• KODE LISENSI RESMI : " + tokenGenerated + "\n" +
            "• PAKET LISENSI      : " + pkg + "\n" +
            "• KUOTA PERANGKAT    : Maksimal " + maxDevices + " Perangkat (HP, Laptop, Tablet)\n" +
            "• ID PEMESANAN       : " + orderId + "\n" +
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
            "LANGKAH MUDAH AKTIVASI 1-KLIK:\n" +
            "1. Buka tautan aktivasi langsung di browser HP atau Laptop Anda:\n" +
            "   https://sambarangpro.github.io/keuanganku/?token=" + encodeURIComponent(tokenGenerated) + "\n\n" +
            "2. Aplikasi akan otomatis memvalidasi lisensi dan membuka dashboard penuh.\n\n" +
            "3. Panduan Penggunaan Lengkap Bergambar:\n" +
            "   https://sambarangpro.github.io/keuanganku/poster-panduan-penggunaan.html\n\n" +
            "Simpan email ini dengan baik sebagai bukti kepemilikan lisensi resmi seumur hidup Anda.\n" +
            "Terima kasih telah menjadi bagian dari peluncuran perdana Keuanganku PRO! 🙏✨\n\n" +
            "Salam hormat,\n" +
            "Tim Official KEUANGANKU PRO\n" +
            "Email: keuangankupro@gmail.com\n" +
            "Copyright © 2026 Sambarang Production";

          MailApp.sendEmail({
            to: email,
            subject: pioneerEmailSubject,
            body: pioneerEmailBody
          });
          logEvent("LICENSE_EMAIL_SENT", tokenGenerated, buyerName, "-", "-", "Email lisensi perdana terkirim ke " + email);
        } catch(errMail) {
          logEvent("LICENSE_EMAIL_FAILED", tokenGenerated, buyerName, "-", "-", "Gagal kirim email perdana: " + errMail.toString());
        }
      }
    } catch(errTokSheet) {}
  }

  var lastCol = sheet.getLastColumn();
  var ordHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var ordColMap = getOrderColumnIndexes(ordHeaders);

  if (ordHeaders.length >= 14 || (ordColMap.paymentProof !== undefined && ordColMap.paymentProof === 9)) {
    sheet.appendRow(safeRow_([
      orderId,
      nowStr,
      buyerName,
      whatsapp,
      safeCell_(email),
      pkg,
      maxDevices,
      price,
      paymentMethod,
      paymentProof,
      orderStatus,
      tokenGenerated,
      fullNotes,
      nowStr
    ]));
  } else {
    sheet.appendRow(safeRow_([
      orderId,
      nowStr,
      buyerName,
      whatsapp,
      safeCell_(email),
      pkg,
      maxDevices,
      price,
      paymentMethod,
      orderStatus,
      tokenGenerated,
      fullNotes + (paymentProof ? " [Bukti: " + paymentProof + "]" : ""),
      nowStr
    ]));
  }

  logEvent("PUBLIC_ORDER_SUBMITTED", tokenGenerated || "-", buyerName, "-", "-", "Pesanan online masuk: " + orderId + " (" + pkg + " - " + price + ")");

  return {
    success: true,
    message: tokenGenerated ? "Selamat! Lisensi resmi seumur hidup Anda telah terbit." : "Pesanan Anda berhasil dikirim!",
    orderId: orderId,
    orderSeq: orderSeq,
    timestamp: nowStr,
    buyerName: buyerName,
    package: pkg,
    price: price,
    uniqueCode: uCodePadded,
    paymentMethod: paymentMethod,
    token: tokenGenerated,
    maxDevices: maxDevices,
    isEarlyAdopter: isEarlyAdopter
  };
}

function adminSaveSalesSettings(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };

  var current = getStoredSalesSettings();
  try {
    if (params.packages) current.packages = typeof params.packages === 'string' ? JSON.parse(params.packages) : params.packages;
  } catch(e) {}
  try {
    if (params.vouchers) {
      var incoming = typeof params.vouchers === 'string' ? JSON.parse(params.vouchers) : params.vouchers;
      // Jangan biarkan data dashboard yang sudah lama MENGURANGI hitungan pemakaian voucher
      var usedByCode = {};
      (current.vouchers || []).forEach(function(v) { usedByCode[String(v.code || "").toUpperCase()] = Number(v.usedCount) || 0; });
      (incoming || []).forEach(function(v) {
        var stored = usedByCode[String(v.code || "").toUpperCase()] || 0;
        v.usedCount = Math.max(Number(v.usedCount) || 0, stored);
      });
      current.vouchers = incoming;
    }
  } catch(e) {}
  try {
    if (params.paymentAccounts) current.paymentAccounts = typeof params.paymentAccounts === 'string' ? JSON.parse(params.paymentAccounts) : params.paymentAccounts;
  } catch(e) {}
  if (params.sellerWhatsApp !== undefined) current.sellerWhatsApp = String(params.sellerWhatsApp).trim();
  if (params.orderFormUrl !== undefined) current.orderFormUrl = String(params.orderFormUrl).trim();
  // Fonnte dinonaktifkan pemilik demi keamanan: token tidak disimpan lagi
  current.fonnteToken = "";
  current.fonnteAutoSend = false;
  if (params.orderMode !== undefined) current.orderMode = String(params.orderMode).trim().toUpperCase();
  if (params.launchSeqOffset !== undefined) current.launchSeqOffset = parseInt(params.launchSeqOffset, 10) || 0;

  PropertiesService.getScriptProperties().setProperty("KEUANGANKU_SALES_SETTINGS", JSON.stringify(current));
  logEvent("SALES_SETTINGS_UPDATED", "-", "Developer", "-", "-", "Pengaturan paket, voucher, dan rekening pembayaran diperbarui.");

  return {
    success: true,
    message: "Pengaturan katalog penjualan & voucher berhasil disimpan!",
    salesSettings: current
  };
}

function adminSetOrderMode(params) {
  if (!checkAdminAuth(params.adminPassword)) return { success: false, message: "Akses ditolak." };
  var mode = String(params.orderMode || "TESTING").toUpperCase();
  var current = getStoredSalesSettings();
  current.orderMode = mode;

  var ss = getSpreadsheet();
  var sheet = ss ? ss.getSheetByName(SHEET_ORDERS) : null;
  var lastRow = sheet ? sheet.getLastRow() : 1;

  if (params.resetSeq || mode === "LIVE") {
    current.launchSeqOffset = lastRow; // Simpan offset baris terakhir saat ini agar order berikutnya mulai dari #1
  } else if (mode === "TESTING" && params.resetSeqOffset) {
    current.launchSeqOffset = 0;
  }

  PropertiesService.getScriptProperties().setProperty("KEUANGANKU_SALES_SETTINGS", JSON.stringify(current));
  logEvent("ORDER_MODE_CHANGED", "-", "Developer", "-", "-", "Mode pemesanan disetel ke " + mode + " (Launch Offset: " + (current.launchSeqOffset || 0) + ")");

  return {
    success: true,
    message: (mode === "LIVE") 
      ? "🚀 Mode Launching Resmi (v1.0) Aktif! Urutan kode unik pembayaran berikutnya otomatis dimulai dari antrean pertama (#1 / +01)." 
      : "🧪 Mode Uji Coba Pemesanan (v0.1) Aktif.",
    salesSettings: current,
    nextOrderSeq: 1,
    nextUniqueCode: 1
  };
}

/**
 * ==============================================================================
 * FUNGSI DIAGNOSTIK & OTORISASI CEPAT (Jalankan di Google Apps Script Editor)
 * ==============================================================================
 * Pilih fungsi 'testSystemDeployment' di menu dropdown atas Google Apps Script,
 * lalu klik 'Jalankan' (Run).
 * Fungsi ini akan:
 * 1. Menghubungkan & memastikan Spreadsheet aktif (Tab Tokens, Logs, Orders).
 * 2. Memicu pop-up izin otorisasi Google Workspace (Drive & Mail) jika belum diizinkan.
 * 3. Memastikan folder Google Drive untuk foto bukti struk sudah siap.
 */
function testSystemDeployment() {
  Logger.log("=====================================================");
  Logger.log("🔍 MEMULAI VERIFIKASI MASTER BACKEND KEUANGANKU PRO");
  Logger.log("=====================================================");

  // 1. Spreadsheet Check
  var ss = getSpreadsheet();
  if (!ss) {
    var errMsg = "Spreadsheet TIDAK ditemukan! Pastikan SPREADSHEET_URL_OR_ID di baris 30 sudah terisi benar.";
    Logger.log("❌ ERROR: " + errMsg);
    return errMsg;
  }
  Logger.log("✅ 1. Spreadsheet Terhubung: " + ss.getName());

  // 2. Inisialisasi Sheet & Kolom Orders
  initSheets();
  var ordersSheet = ss.getSheetByName(SHEET_ORDERS);
  var ordCols = ordersSheet ? ordersSheet.getLastColumn() : 0;
  Logger.log("✅ 2. Tab Database Lengkap: 'Tokens', 'Logs', dan 'Orders' (" + ordCols + " kolom).");

  // 3. Tes Google Drive (Penyimpanan Foto Bukti Transfer)
  try {
    var folderName = "Bukti_Transfer_Keuanganku";
    var folders = DriveApp.getFoldersByName(folderName);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    Logger.log("✅ 3. Google Drive Siap: Folder '" + folder.getName() + "' (ID: " + folder.getId() + ")");
  } catch(errDrive) {
    Logger.log("⚠️ 3. Info Izin Drive: " + errDrive.toString());
  }

  // 4. Pengaturan Penjualan & Mode
  var settings = getStoredSalesSettings();
  Logger.log("✅ 4. Mode Pemesanan: " + (settings.orderMode || "TESTING"));
  Logger.log("      - Paket Lisensi : " + (settings.packages ? settings.packages.length : 0) + " paket");
  Logger.log("      - Rekening/Bank : " + (settings.paymentAccounts ? settings.paymentAccounts.length : 0) + " rekening");
  Logger.log("      - Kupon/Voucher : " + (settings.vouchers ? settings.vouchers.length : 0) + " voucher");

  Logger.log("=====================================================");
  Logger.log("🎉 STATUS: BACKEND SIAP 100%!");
  Logger.log("Langkah Terakhir:");
  Logger.log("1. Klik menu 'Terapkan' (Deploy) di kanan atas.");
  Logger.log("2. Pilih 'Kelola penerapan' (Manage deployments).");
  Logger.log("3. Klik ikon Pensil (Edit) pada penerapan aktif.");
  Logger.log("4. Pada Versi, pilih 'Versi baru' (New version).");
  Logger.log("5. Klik tombol 'Terapkan' (Deploy).");
  Logger.log("=====================================================");

  return "BERHASIL: Sistem siap 100%! Silakan Terapkan > Kelola Penerapan > Versi Baru.";
}

/**
 * ==============================================================================
 * BRING YOUR OWN DATABASE (BYODb) & GOOGLE ACCOUNT AUTHENTICATION SUITE
 * ==============================================================================
 */

/**
 * Sensor sensor email untuk tampilan keamanan (misal: mo***@gmail.com)
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string') return "";
  var parts = email.split('@');
  if (parts.length < 2) return email;
  var name = parts[0];
  var domain = parts[1];
  if (name.length <= 2) return name.charAt(0) + "*@" + domain;
  var visible = name.substring(0, 2);
  return visible + "***@" + domain;
}

/**
 * Verifikasi Akun Google Pengguna (BYODb Architecture)
 * Dipanggil saat pengguna mengklik tombol "Masuk dengan Akun Google"
 */
function verifyGoogleAccount(params) {
  var deviceId = String(params.deviceId || "").trim();
  var deviceName = String(params.deviceName || "Perangkat Google").trim();

  // Email WAJIB diverifikasi langsung ke Google. Email kiriman aplikasi tidak dipercaya.
  var emailInput = getVerifiedGoogleEmail_(params.googleAccessToken);
  if (!emailInput) {
    return { success: false, needsReauth: true, message: "Akun Google tidak dapat diverifikasi. Silakan masuk ulang dengan Google (pastikan izin email dicentang).", diag: LAST_GOOGLE_VERIFY_DIAG };
  }
  if (!deviceId) {
    return { success: false, message: "Device ID tidak terdeteksi oleh sistem." };
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    return { 
      success: true, 
      isLicensed: false, 
      email: emailInput, 
      message: "Database lisensi masih kosong." 
    };
  }

  var colMap = getTokenColumnIndexes(data[0]);

  for (var i = 1; i < data.length; i++) {
    var rowToken = String(data[i][colMap.token] || "").trim().toUpperCase();
    var boundEmail = (colMap.buyerEmail !== undefined && data[i][colMap.buyerEmail]) ? String(data[i][colMap.buyerEmail]).trim().toLowerCase() : "";
    var contactVal = String(data[i][colMap.buyerContact] || "").trim().toLowerCase();
    var buyerName = String(data[i][colMap.buyerName] || "").trim();

    // Logika Pencocokan Akun:
    // 1. Kolom "Email Google (BYODb)" cocok dengan emailInput
    // 2. ATAU Kolom "Buyer Contact" berisi emailInput (jika pembeli memasukkan email saat beli)
    // 3. ATAU Akun Khusus Pemilik Developer (Moh Athhar / Sambarang)
    // 4. ATAU Akun Demo Iklan (demo@keuanganku.id atau PRO-DEMO-IKLAN-2026)
    // Kontak pembeli bisa berisi "0812xxxx | email@gmail.com" -> cocokkan email secara PERSIS per bagian
    var contactEmails = contactVal.split(/[|,;\s]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s.indexOf("@") > 0; });

    var isMatch = false;
    if (boundEmail && boundEmail === emailInput) {
      isMatch = true;
    } else if (!boundEmail && contactEmails.indexOf(emailInput) !== -1) {
      isMatch = true;
      if (colMap.buyerEmail !== undefined) {
        sheet.getRange(i + 1, colMap.buyerEmail + 1).setValue(emailInput);
        boundEmail = emailInput;
      }
    } else if (isOwnerToken_(rowToken) && isOwnerEmail_(emailInput)) {
      // Email pemilik terdaftar (persis) boleh masuk ke token pemilik
      isMatch = true;
      if (!boundEmail && colMap.buyerEmail !== undefined) {
        sheet.getRange(i + 1, colMap.buyerEmail + 1).setValue(emailInput);
        boundEmail = emailInput;
      }
    }

    if (isMatch) {
      var status = String(data[i][colMap.status] || "ACTIVE").trim().toUpperCase();
      if (status === "BLOCKED") {
        logEvent("BLOCKED_GOOGLE_ATTEMPT", rowToken, buyerName, deviceId, deviceName, "Login Google ditolak: Lisensi diblokir (" + emailInput + ")");
        return {
          success: false,
          isLicensed: false,
          isBlocked: true,
          message: "Akun lisensi untuk email ini telah dinonaktifkan oleh Developer."
        };
      }

      var maxDevices = parseInt(data[i][colMap.maxDevices]) || 3;
      if (maxDevices < 3) maxDevices = 3;
      if (hasPriorityQuota_(rowToken)) {
        maxDevices = Math.max(maxDevices, 10);
      }

      var rawDevices = data[i][colMap.usedDevices];
      var devices = [];
      try { devices = rawDevices ? JSON.parse(rawDevices) : []; } catch(e) { devices = []; }

      var pinStatus = String(data[i][colMap.pinStatus] || "UNCLAIMED").trim().toUpperCase();
      var storedPersonalPin = String(data[i][colMap.personalPin] || "").trim();

      var existingDevice = null;
      for (var d = 0; d < devices.length; d++) {
        if (devices[d].deviceId === deviceId) {
          existingDevice = devices[d];
          break;
        }
      }

      if (existingDevice) {
        existingDevice.lastActive = new Date().toISOString();
        existingDevice.deviceName = deviceName;
        sheet.getRange(i + 1, colMap.usedDevices + 1).setValue(JSON.stringify(devices));
      } else {
        if (isDeviceRemoved_(rowToken, deviceId)) {
          logEvent("REMOVED_DEVICE_BLOCKED", rowToken, buyerName, deviceId, deviceName, "Ditolak: perangkat yang sudah dikeluarkan mencoba masuk lagi lewat akun Google");
          return { success: false, isLicensed: true, deviceRemoved: true, message: REMOVED_DEVICE_MESSAGE };
        }
        if (devices.length >= maxDevices) {
          logEvent("GOOGLE_MAX_DEVICES", rowToken, buyerName, deviceId, deviceName, "Kuota perangkat penuh (" + maxDevices + ")");
          return {
            success: false,
            isLicensed: true,
            quotaExceeded: true,
            maxDevices: maxDevices,
            deviceCount: devices.length,
            message: "Batas kuota perangkat telah penuh (Maksimal " + maxDevices + " perangkat). Silakan kelola perangkat Anda atau hubungi Developer."
          };
        }

        var newDev = {
          deviceId: deviceId,
          deviceName: deviceName,
          activatedAt: new Date().toISOString(),
          lastActive: new Date().toISOString()
        };
        devices.push(newDev);

        sheet.getRange(i + 1, colMap.deviceCount + 1).setValue(devices.length);
        sheet.getRange(i + 1, colMap.usedDevices + 1).setValue(JSON.stringify(devices));
      }

      var currentSpreadsheetId = (colMap.spreadsheetId !== undefined && data[i][colMap.spreadsheetId]) ? String(data[i][colMap.spreadsheetId]).trim() : "";
      var currentCloudUrl = (colMap.cloudUrl !== undefined && data[i][colMap.cloudUrl]) ? stripCloudKey_(data[i][colMap.cloudUrl]) : "";

      logEvent("GOOGLE_AUTH_SUCCESS", rowToken, buyerName, deviceId, deviceName, "Berhasil masuk dengan akun Google: " + emailInput);

      return {
        success: true,
        isLicensed: true,
        data: {
          token: rowToken,
          buyerName: buyerName,
          email: emailInput,
          spreadsheetId: currentSpreadsheetId,
          cloudUrl: currentCloudUrl,
          pinStatus: pinStatus,
          maxDevices: maxDevices,
          deviceCount: devices.length
        }
      };
    }
  }

  // Jika akun Google belum terikat dengan token apa pun
  return {
    success: true,
    isLicensed: false,
    email: emailInput,
    message: "Akun Google (" + emailInput + ") belum terhubung dengan Token Lisensi Keuanganku PRO. Masukkan Token Lisensi Anda untuk menghubungkan akun."
  };
}

/**
 * Menautkan Akun Google ke Token Lisensi Tertentu
 */
function bindGoogleAccount(params) {
  var tokenInput = String(params.token || "").trim().toUpperCase();
  var deviceId = String(params.deviceId || "").trim();
  var deviceName = String(params.deviceName || "Perangkat Google").trim();

  if (!tokenInput) {
    return { success: false, message: "Token lisensi wajib diisi." };
  }
  // Email diambil dari Google langsung, bukan dari kiriman aplikasi
  var emailInput = getVerifiedGoogleEmail_(params.googleAccessToken);
  if (!emailInput) {
    return { success: false, needsReauth: true, message: "Akun Google tidak dapat diverifikasi. Silakan masuk ulang dengan Google.", diag: LAST_GOOGLE_VERIFY_DIAG };
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { success: false, message: "Database lisensi masih kosong." };
  var colMap = getTokenColumnIndexes(data[0]);

  var cleanInputToken = tokenInput.replace(/[^A-Z0-9]/g, '');

  for (var i = 1; i < data.length; i++) {
    var rowToken = String(data[i][colMap.token] || "").trim().toUpperCase();
    var cleanRowToken = rowToken.replace(/[^A-Z0-9]/g, '');

    if (rowToken === tokenInput || (cleanInputToken && cleanRowToken === cleanInputToken)) {
      tokenInput = rowToken;
      var buyerName = String(data[i][colMap.buyerName] || "");
      var boundEmail = (colMap.buyerEmail !== undefined && data[i][colMap.buyerEmail]) ? String(data[i][colMap.buyerEmail]).trim().toLowerCase() : "";

      var bindStatus = String(data[i][colMap.status] || "ACTIVE").trim().toUpperCase();
      if (bindStatus === "BLOCKED") {
        return { success: false, message: "Lisensi ini sedang diblokir oleh developer." };
      }

      if (boundEmail && boundEmail !== emailInput && !(isOwnerToken_(rowToken) && isOwnerEmail_(emailInput))) {
        return {
          success: false,
          message: "Token ini sudah terhubung secara permanen dengan akun Google lain (" + maskEmail(boundEmail) + "). Gunakan akun tersebut atau hubungi developer."
        };
      }

      // Token yang sudah dipersonalisasi (PIN pribadi) hanya boleh ditautkan dari perangkat
      // yang sudah terdaftar, agar orang yang hanya tahu token tidak bisa mengklaimnya.
      var bindDevices = parseDevices_(data[i][colMap.usedDevices]);
      var bindPinStatus = String(data[i][colMap.pinStatus] || "").trim().toUpperCase();
      var bindStoredPin = String(data[i][colMap.personalPin] || "").trim();
      if (deviceIndex_(bindDevices, deviceId) === -1 && isDeviceRemoved_(rowToken, deviceId)) {
        return { success: false, deviceRemoved: true, message: REMOVED_DEVICE_MESSAGE };
      }
      if (!boundEmail && bindDevices.length > 0 && deviceIndex_(bindDevices, deviceId) === -1) {
        // Anti tebak PIN: dulu jalur ini tidak dibatasi sehingga PIN bisa dicoba berulang-ulang
        if (isRateLimited_("PIN", rowToken, 6)) {
          return { success: false, needsPin: true, message: "Terlalu banyak percobaan PIN yang salah. Tunggu 15 menit lalu coba lagi." };
        }
        var pinOk = bindStoredPin && pinEquals_(params.pin, bindStoredPin);
        if (!pinOk) {
          if (params.pin) registerFailure_("PIN", rowToken, 900);
          logEvent("GOOGLE_BIND_REJECTED", rowToken, buyerName, deviceId, deviceName, "Ditolak: tautkan Google dari perangkat tidak terdaftar tanpa PIN benar (" + emailInput + ")");
          return {
            success: false,
            needsPin: true,
            message: (bindPinStatus === "PIN_CHANGED" || bindStoredPin)
              ? "Token ini sudah aktif di perangkat lain. Tautkan akun Google dari HP yang sudah aktif, atau masukkan PIN Pribadi Anda."
              : "Token ini sudah aktif di perangkat lain. Tautkan akun Google dari HP yang sudah aktif tersebut."
          };
        }
      }

      if (colMap.buyerEmail !== undefined && !boundEmail) {
        sheet.getRange(i + 1, colMap.buyerEmail + 1).setValue(emailInput);
      }

      if (params.spreadsheetId && colMap.spreadsheetId !== undefined && /^[A-Za-z0-9_-]{20,100}$/.test(String(params.spreadsheetId).trim())) {
        sheet.getRange(i + 1, colMap.spreadsheetId + 1).setValue(String(params.spreadsheetId).trim());
      }

      logEvent("GOOGLE_ACCOUNT_BOUND", tokenInput, buyerName, deviceId, deviceName, "Token berhasil ditautkan ke akun Google: " + emailInput);

      return {
        success: true,
        message: "Akun Google " + emailInput + " berhasil ditautkan permanen ke lisensi Anda!",
        data: {
          token: tokenInput,
          buyerName: buyerName,
          email: emailInput
        }
      };
    }
  }

  return { success: false, message: "Kode Token tidak ditemukan di sistem." };
}

/**
 * Menyimpan Spreadsheet ID milik Pengguna (BYODb) ke baris lisensinya
 */
function saveSpreadsheetId(params) {
  var tokenInput = String(params.token || "").trim().toUpperCase();
  var emailInput = String(params.email || "").trim().toLowerCase();
  var spreadsheetId = String(params.spreadsheetId || "").trim();

  if (!spreadsheetId) {
    return { success: false, message: "Spreadsheet ID tidak boleh kosong." };
  }

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { success: false, message: "Database lisensi masih kosong." };
  var colMap = getTokenColumnIndexes(data[0]);

  var verifiedEmail = params.googleAccessToken ? getVerifiedGoogleEmail_(params.googleAccessToken) : "";
  var reqDeviceId = String(params.deviceId || "").trim();

  for (var i = 1; i < data.length; i++) {
    var rowToken = String(data[i][colMap.token] || "").trim().toUpperCase();
    var boundEmail = (colMap.buyerEmail !== undefined && data[i][colMap.buyerEmail]) ? String(data[i][colMap.buyerEmail]).trim().toLowerCase() : "";

    var isMatch = false;
    if (tokenInput && tokensMatch_(rowToken, tokenInput)) isMatch = true;
    else if (!tokenInput && verifiedEmail && boundEmail === verifiedEmail) isMatch = true;

    if (isMatch) {
      // Hanya pemilik sah: perangkat terdaftar ATAU akun Google terverifikasi yang tertaut ke token ini
      var ssDevices = parseDevices_(data[i][colMap.usedDevices]);
      var authorized = (deviceIndex_(ssDevices, reqDeviceId) !== -1) || (verifiedEmail && boundEmail && verifiedEmail === boundEmail);
      if (!authorized) {
        return { success: false, message: "Tidak diizinkan menyimpan Spreadsheet ID untuk lisensi ini." };
      }
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(spreadsheetId)) {
        return { success: false, message: "Format Spreadsheet ID tidak valid." };
      }
      if (colMap.spreadsheetId !== undefined) {
        sheet.getRange(i + 1, colMap.spreadsheetId + 1).setValue(spreadsheetId);
        logEvent("SPREADSHEET_ID_SAVED", rowToken, String(data[i][colMap.buyerName] || ""), "-", "-", "Spreadsheet ID BYODb disimpan: " + spreadsheetId);
        return { 
          success: true, 
          message: "Spreadsheet ID berhasil disimpan ke server master.", 
          spreadsheetId: spreadsheetId 
        };
      }
    }
  }

  return { success: false, message: "Lisensi tidak ditemukan untuk menyimpan Spreadsheet ID." };
}

// ============================================================
// FONNTE WHATSAPP GATEWAY SERVER PROXY
// ============================================================

function adminSendFonnte(params) {
  return { success: false, status: false, message: "Fitur Fonnte dinonaktifkan oleh pemilik demi keamanan. Kirim pesan WhatsApp secara manual." };
}

function adminSendFonnte_legacyDisabled_(params) {
  var token = params.fonnteToken;
  if (!token) {
    try {
      var s = getStoredSalesSettings();
      token = s.fonnteToken;
    } catch(e) {}
  }
  if (!token) return { success: false, status: false, message: "Fonnte API Token belum diatur di server." };

  var target = String(params.target || "").trim().replace(/[^0-9]/g, "");
  if (target.indexOf("0") === 0) target = "62" + target.substring(1);
  if (target.indexOf("8") === 0) target = "628" + target.substring(1);

  if (!target || target.length < 9) {
    return { success: false, status: false, message: "Nomor WhatsApp tujuan tidak valid: " + params.target };
  }

  try {
    var response = UrlFetchApp.fetch("https://api.fonnte.com/send", {
      method: "post",
      headers: { "Authorization": token },
      payload: {
        target: target,
        message: params.message || "",
        countryCode: "62"
      },
      muteHttpExceptions: true
    });
    var resJson = JSON.parse(response.getContentText());
    if (resJson && resJson.status === true) {
      logEvent("FONNTE_WA_SENT", "-", "-", "-", "-", "Pesan WhatsApp via Fonnte terkirim ke: " + target);
    }
    return resJson;
  } catch(e) {
    return { success: false, status: false, message: "UrlFetch Fonnte Error: " + e.message };
  }
}

function adminCheckFonnteDevice(params) {
  return { success: false, status: false, message: "Fitur Fonnte dinonaktifkan oleh pemilik demi keamanan." };
}

function adminCheckFonnteDevice_legacyDisabled_(params) {
  var token = params.fonnteToken;
  if (!token) {
    try {
      var s = getStoredSalesSettings();
      token = s.fonnteToken;
    } catch(e) {}
  }
  if (!token) return { success: false, status: false, message: "Fonnte API Token belum diatur." };

  try {
    var response = UrlFetchApp.fetch("https://api.fonnte.com/device", {
      method: "post",
      headers: { "Authorization": token },
      muteHttpExceptions: true
    });
    var resJson = JSON.parse(response.getContentText());
    return resJson;
  } catch(e) {
    return { success: false, status: false, message: "UrlFetch Fonnte Error: " + e.message };
  }
}
