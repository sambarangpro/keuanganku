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

// Ganti kata sandi admin rahasia Anda di sini:
var MASTER_ADMIN_PASSWORD = "adminKeuanganku2026!";

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
    notes: 10
  };

  if (!headers || !headers.length) return map;

  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (h === "token" || h.includes("lisensi")) map.token = c;
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
      "Device Count", "Used Devices (JSON)", "Status", "PIN Status", "Personal PIN", "Created At", "Notes", "Cloud URL"
    ]);
    tokensSheet.getRange("A1:L1").setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
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

    // 1. Cadangan Full JSON ke Sheet Database_Keuangan
    var dbSheet = ss.getSheetByName("Database_Keuangan");
    if (!dbSheet) {
      dbSheet = ss.insertSheet("Database_Keuangan");
      dbSheet.appendRow(["Cadangan JSON Database Keuangan", "Status Terakhir"]);
      dbSheet.getRange("A1:B1").setFontWeight("bold").setBackground("#1e293b").setFontColor("#38bdf8");
    }
    dbSheet.getRange("A2").setValue(rawData);
    dbSheet.getRange("B2").setValue("Diperbarui: " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"));

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

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};

  // 1. Jika ada parameter action, jalankan API Lisensi / Pairing / Admin
  if (params.action) {
    return handleRequest(params);
  }

  // 2. Jika TIDAK ada parameter action, ini adalah permintaan GET Sinkronisasi Data Keuangan
  var doc = PropertiesService.getScriptProperties();
  var data = doc.getProperty("KEUANGANKU_DATA");

  // Jika di PropertiesService belum ada, coba baca dari tab Database_Keuangan cell A2
  if (!data) {
    try {
      var ss = getSpreadsheet();
      if (ss) {
        var dbSheet = ss.getSheetByName("Database_Keuangan");
        if (dbSheet) {
          var val = dbSheet.getRange("A2").getValue();
          if (val && String(val).trim().startsWith("{")) {
            data = String(val).trim();
            doc.setProperty("KEUANGANKU_DATA", data);
          }
        }
      }
    } catch(err) {}
  }

  if (!data) {
    return ContentService.createTextOutput(JSON.stringify({ 
      status: "empty", 
      accounts: [], 
      recentHistory: [],
      message: "Database keuangan cloud belum berisi data. Klik 'Paksa Upload ke Cloud' di aplikasi untuk mengunggah data pertama kali." 
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(data)
    .setMimeType(ContentService.MimeType.JSON);
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

  // 2. Jika TIDAK ada action (atau berisi data keuangan accounts / recentHistory / globalData):
  // Ini adalah UPLOAD SINKRONISASI DATABASE KEUANGAN PENGGUNA!
  try {
    if (rawData) {
      // Simpan ke Script Properties untuk sinkronisasi instan berkecepatan tinggi
      var doc = PropertiesService.getScriptProperties();
      doc.setProperty("KEUANGANKU_DATA", rawData);

      // Simpan & format ke tab Spreadsheet fisik
      saveFinancialDataToSheets(rawData, params);

      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        success: true,
        message: "Data keuangan berhasil disimpan dan disinkronkan ke Google Sheets",
        timestamp: new Date()
      })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      success: false,
      message: "Gagal menyimpan data keuangan: " + err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return handleRequest(params);
}

function handleRequest(params) {
  var action = params.action || "";
  var result = { success: false, message: "Action tidak dikenal" };

  try {
    // Simpan sheetUrl jika dikirimkan oleh parameter
    if (params.sheetUrl && typeof params.sheetUrl === 'string' && params.sheetUrl.trim()) {
      try {
        var customSs = SpreadsheetApp.openByUrl(params.sheetUrl.trim());
        if (customSs) {
          PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", customSs.getId());
        }
      } catch(e) {}
    }

    // Aksi pairing barcode sesi TIDAK memerlukan spreadsheet (hanya butuh CacheService)
    if (action !== "create_pair_session" && action !== "check_pair_session") {
      initSheets();
    }

    switch(action) {
      // -------------------------------------------------------------
      // API APLIKASI KLIEN
      // -------------------------------------------------------------
      case "validate_token":
        result = validateClientToken(params);
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

      case "submit_public_order":
        result = submitPublicOrder(params);
        break;

      case "admin_save_sales_settings":
        result = adminSaveSalesSettings(params);
        break;

      case "admin_set_order_mode":
        result = adminSetOrderMode(params);
        break;

      // -------------------------------------------------------------
      // API SINKRONISASI DATA KEUANGAN PENGGUNA
      // -------------------------------------------------------------
      case "get_financial_data":
        var savedData = PropertiesService.getScriptProperties().getProperty("KEUANGANKU_DATA") || "{}";
        return ContentService.createTextOutput(savedData).setMimeType(ContentService.MimeType.JSON);

      case "save_financial_data":
        if (params.data) {
          var dataStr = typeof params.data === 'string' ? params.data : JSON.stringify(params.data);
          var parsedObj = typeof params.data === 'string' ? JSON.parse(params.data) : params.data;
          PropertiesService.getScriptProperties().setProperty("KEUANGANKU_DATA", dataStr);
          saveFinancialDataToSheets(dataStr, parsedObj);
        }
        result = { success: true, message: "Data keuangan berhasil disimpan." };
        break;

      default:
        result = { success: false, message: "Action '" + action + "' tidak valid." };
    }
  } catch(err) {
    result = { success: false, message: "Server error: " + err.toString() };
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
      var maxDevices = parseInt(data[i][colMap.maxDevices]) || 2;
      // Berikan batas kuota prioritas pemilik/developer akun agar bebas multi-perangkat saat pengujian
      if (tokenInput === 'PRO-S8GF-HQT5-CNVE' || tokenInput === 'PRO-W9J2-RAYM-3KKL' || String(buyerName).toLowerCase().includes('akbar')) {
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
        if (pinStatus !== "PIN_CHANGED" && storedPersonalPin && storedPersonalPin.length <= 20 && !storedPersonalPin.includes("GMT")) {
          pinStatus = "PIN_CHANGED";
        } else if (pinStatus !== "PIN_CHANGED") {
          pinStatus = "USING_TOKEN";
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
          if (storedPersonalPin && inputPin !== storedPersonalPin) {
            logEvent("WRONG_PERSONAL_PIN", tokenInput, buyerName, deviceId, deviceName, "Salah memasukkan PIN pribadi");
            return {
              success: false,
              isBurned: true,
              message: "PIN Pribadi salah! Masukkan PIN pribadi yang telah Anda buat sebelumnya."
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

      var currentCloudUrl = (colMap.cloudUrl !== undefined && data[i][colMap.cloudUrl]) ? String(data[i][colMap.cloudUrl]).trim() : "";
      if (params.cloudUrl && colMap.cloudUrl !== undefined) {
        var newCloudUrl = String(params.cloudUrl).trim();
        if (newCloudUrl && newCloudUrl !== currentCloudUrl) {
          currentCloudUrl = newCloudUrl;
          sheet.getRange(i + 1, colMap.cloudUrl + 1).setValue(currentCloudUrl);
        }
      }

      // 3. Cek apakah perangkat sudah ada (Re-login)
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
            pinStatus: pinStatus,
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
          pinStatus: newPinStatus,
          isPasswordChanged: (newPinStatus === "PIN_CHANGED"),
          maxDevices: (newPinStatus === "PIN_CHANGED" ? maxDevices : 1),
          deviceCount: devices.length,
          activatedAt: newDevObj.activatedAt,
          cloudUrl: currentCloudUrl
        }
      };
    }
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

  if (!sessionId) {
    sessionId = "PAIR-" + Utilities.getUuid().substring(0, 8).toUpperCase();
  }

  var cache = CacheService.getScriptCache();
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

  var cache = CacheService.getScriptCache();
  var raw = cache.get(sessionId);
  var sessionObj = null;
  if (raw) {
    try { sessionObj = JSON.parse(raw); } catch(e) {}
  }
  if (!sessionObj) {
    sessionObj = {
      status: "WAITING",
      sessionId: sessionId,
      deviceId: (params.targetDeviceId || "").trim() || ("DEV-" + Date.now().toString(36).toUpperCase()),
      deviceName: (params.targetDeviceName || "").trim() || "Perangkat Web",
      createdAt: Date.now()
    };
  }

  var targetDeviceId = sessionObj.deviceId || (params.targetDeviceId || "").trim() || ("DEV-" + Date.now().toString(36).toUpperCase());
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
  var maxDevices = parseInt(rowData[colMap.maxDevices]) || 2;
  var status = String(rowData[colMap.status] || "ACTIVE").trim().toUpperCase();
  var pinStatus = String(rowData[colMap.pinStatus] || "UNCLAIMED").trim().toUpperCase();
  var storedPersonalPin = String(rowData[colMap.personalPin] || "").trim();
  var rawDevices = rowData[colMap.usedDevices];

  // Prioritas Kuota Developer / Pemilik Akun
  if (tokenInput === 'PRO-S8GF-HQT5-CNVE' || tokenInput === 'PRO-W9J2-RAYM-3KKL' || String(buyerName).toLowerCase().includes('akbar')) {
    maxDevices = Math.max(maxDevices, 10);
  }

  if (status === "BLOCKED") {
    return { success: false, message: "Lisensi ini sedang diblokir oleh developer." };
  }

  // Parse devices
  var devices = [];
  try { devices = rawDevices ? JSON.parse(rawDevices) : []; } catch(e) { devices = []; }

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

  logEvent("PAIR_SESSION_AUTHORIZED", tokenInput, buyerName, targetDeviceId, targetDeviceName, "Perangkat berhasil ditautkan via Scan HP WhatsApp Style");

  var currentCloudUrl = (colMap.cloudUrl !== undefined && data[foundRow - 1][colMap.cloudUrl]) ? String(data[foundRow - 1][colMap.cloudUrl]).trim() : "";
  if (params.cloudUrl) {
    currentCloudUrl = String(params.cloudUrl).trim();
    if (colMap.cloudUrl !== undefined) {
      sheet.getRange(foundRow, colMap.cloudUrl + 1).setValue(currentCloudUrl);
    }
  }

  // Update session di cache Google Apps Script agar PC/iPad langsung otomatis login
  sessionObj.status = "AUTHORIZED";
  sessionObj.licenseData = {
    token: tokenInput,
    buyerName: buyerName,
    pinStatus: pinStatus,
    isPasswordChanged: (pinStatus === "PIN_CHANGED"),
    maxDevices: maxDevices,
    deviceCount: devices.length,
    cloudUrl: currentCloudUrl
  };
  sessionObj.pin = inputPin || storedPersonalPin || "";
  sessionObj.masterUrl = params.masterUrl || "";
  sessionObj.cloudUrl = currentCloudUrl;

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

      // Update PIN Status menjadi PIN_CHANGED (Token Hangus) & simpan PIN Pribadi
      sheet.getRange(i + 1, colMap.pinStatus + 1).setValue("PIN_CHANGED");
      sheet.getRange(i + 1, colMap.personalPin + 1).setValue(newPin);

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
    if (String(data[i][colMap.token]).trim().toUpperCase() === tokenInput) {
      var status = String(data[i][colMap.status] || "ACTIVE").trim().toUpperCase();
      var pinStatus = String(data[i][colMap.pinStatus] || "UNCLAIMED").trim().toUpperCase();

      if (status !== "ACTIVE") {
        return { success: true, active: false, reason: "BLOCKED", message: "Lisensi ini telah dinonaktifkan." };
      }

      var rawDevices = data[i][colMap.usedDevices];
      var devices = [];
      try { devices = rawDevices ? JSON.parse(rawDevices) : []; } catch(e) {}

      var storedPersonalPin = String(data[i][colMap.personalPin] || "").trim();
      if (pinStatus !== "PIN_CHANGED" && storedPersonalPin && storedPersonalPin.length <= 20 && !storedPersonalPin.includes("GMT")) pinStatus = "PIN_CHANGED";
      else if (pinStatus !== "PIN_CHANGED" && devices.length > 0) pinStatus = "USING_TOKEN";

      var isFound = false;
      for (var d = 0; d < devices.length; d++) {
        if (devices[d].deviceId === deviceId) {
          isFound = true;
          break;
        }
      }

      if (!isFound) {
        return { success: true, active: false, reason: "DEVICE_REMOVED", message: "Perangkat ini telah dilepas dari lisensi." };
      }

      var currentCloudUrl = (colMap.cloudUrl !== undefined && data[i][colMap.cloudUrl]) ? String(data[i][colMap.cloudUrl]).trim() : "";
      if (params.cloudUrl && colMap.cloudUrl !== undefined) {
        var newCloudUrl = String(params.cloudUrl).trim();
        if (newCloudUrl && newCloudUrl !== currentCloudUrl) {
          currentCloudUrl = newCloudUrl;
          sheet.getRange(i + 1, colMap.cloudUrl + 1).setValue(currentCloudUrl);
        }
      }

      return { 
        success: true, 
        active: true, 
        buyerName: data[i][colMap.buyerName],
        pinStatus: pinStatus,
        isPasswordChanged: (pinStatus === "PIN_CHANGED"),
        deviceCount: devices.length,
        maxDevices: parseInt(data[i][colMap.maxDevices]) || 2,
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
    if (String(data[i][colMap.token]).trim().toUpperCase() === tokenInput) {
      var buyerName = data[i][colMap.buyerName];
      var status = String(data[i][colMap.status] || "ACTIVE").trim().toUpperCase();
      if (status !== "ACTIVE") {
        return { success: false, message: "Lisensi ini telah dinonaktifkan." };
      }

      var rawDevices = data[i][colMap.usedDevices];
      var devices = [];
      try { devices = rawDevices ? JSON.parse(rawDevices) : []; } catch(e) {}

      var maxDevices = parseInt(data[i][colMap.maxDevices]) || 2;
      // Berikan batas kuota prioritas pemilik/developer akun agar bebas multi-perangkat saat pengujian
      if (tokenInput === 'PRO-S8GF-HQT5-CNVE' || tokenInput === 'PRO-W9J2-RAYM-3KKL' || String(buyerName).toLowerCase().includes('akbar')) {
        maxDevices = Math.max(maxDevices, 10);
      }
      var pinStatus = String(data[i][colMap.pinStatus] || "UNCLAIMED").trim().toUpperCase();
      var storedPersonalPin = String(data[i][colMap.personalPin] || "").trim();

      if (pinStatus !== "PIN_CHANGED" && storedPersonalPin && storedPersonalPin.length <= 20 && !storedPersonalPin.includes("GMT")) pinStatus = "PIN_CHANGED";
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

function deactivateClientDevice(params) {
  var tokenInput = (params.token || "").trim().toUpperCase();
  var targetDeviceId = (params.targetDeviceId || params.deviceId || "").trim();
  var currentDeviceId = (params.currentDeviceId || params.requesterDeviceId || "").trim();

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return { success: false, message: "Token tidak ditemukan" };
  var colMap = getTokenColumnIndexes(data[0]);

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colMap.token]).trim().toUpperCase() === tokenInput) {
      var buyerName = data[i][colMap.buyerName];
      var rawDevices = data[i][colMap.usedDevices];
      var devices = [];
      try { devices = rawDevices ? JSON.parse(rawDevices) : []; } catch(e) {}

      var updated = [];
      var removedName = targetDeviceId;

      if (targetDeviceId === "ALL_OTHERS") {
        updated = devices.filter(function(d) { return d.deviceId === currentDeviceId; });
        logEvent("ALL_OTHER_DEVICES_DEACTIVATED", tokenInput, buyerName, currentDeviceId, "-", "Pengguna mengeluarkan semua perangkat lain");
      } else {
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
  return MASTER_ADMIN_PASSWORD;
}

function checkAdminAuth(password) {
  var effectivePass = getActiveAdminPassword();
  return (password && String(password).trim() === effectivePass);
}

function adminChangePassword(params) {
  if (!checkAdminAuth(params.adminPassword)) {
    return { success: false, message: "Kata sandi lama yang Anda masukkan salah!" };
  }
  var newPass = (params.newAdminPassword || "").trim();
  if (!newPass || newPass.length < 4) {
    return { success: false, message: "Kata sandi baru minimal 4 karakter." };
  }
  PropertiesService.getScriptProperties().setProperty("DEV_PORTAL_PASSWORD", newPass);
  logEvent("ADMIN_PASSWORD_CHANGED", "-", "Developer", "-", "-", "Password Developer Portal berhasil diperbarui.");
  return { success: true, message: "Kata sandi Dev Portal berhasil diperbarui!" };
}

function adminLogin(params) {
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
      var isPinChanged = (pinSt === "PIN_CHANGED") || (storedPersonalPin !== "" && storedPersonalPin.length <= 20 && !storedPersonalPin.includes("GMT"));
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
      buyerName: String(data[i][colMap.buyerName] || ''),
      buyerContact: String(data[i][colMap.buyerContact] || ''),
      maxDevices: parseInt(data[i][colMap.maxDevices]) || 2,
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
    salesSettings: getStoredSalesSettings()
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
  if (!newToken) newToken = generateRandomToken();

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  sheet.appendRow([
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
    notes
  ]);

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

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === token) {
      sheet.getRange(i + 1, 7).setValue(newStatus);
      logEvent("STATUS_TOGGLED", token, data[i][1], "-", "-", "Status lisensi diubah ke: " + newStatus);
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

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === token) {
      sheet.deleteRow(i + 1);
      logEvent("TOKEN_DELETED", token, data[i][1], "-", "-", "Token dihapus permanen oleh Developer.");
      return { success: true, message: "Token berhasil dihapus." };
    }
  }
  return { success: false, message: "Token tidak ditemukan" };
}

function generateRandomToken() {
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function block(len) {
    var str = "";
    for (var i = 0; i < len; i++) str += chars.charAt(Math.floor(Math.random() * chars.length));
    return str;
  }
  return "PRO-" + block(4) + "-" + block(4);
}

function logEvent(event, token, buyerName, deviceId, deviceName, details) {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_LOGS);
    if (!sheet) return;
    var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([nowStr, event, token, buyerName, deviceId, deviceName, details]);
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

  var orderId = (params.orderId || "").trim();
  if (!orderId) {
    var dateCompact = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
    orderId = "ORD-" + dateCompact + "-" + uCodePadded;
  }

  var fullNotes = notes;
  var modeTag = (orderMode === "TESTING") ? "[UJI COBA] " : "";
  if (!fullNotes.includes("Kode Unik")) {
    fullNotes = (fullNotes ? fullNotes + " | " : "") + modeTag + "Kode Unik: " + uCodePadded + " (Urutan #" + orderSeq + ")";
  }

  var tokenGenerated = "";
  if (params.autoGenerateToken && (status === "PAID" || status === "COMPLETED")) {
    tokenGenerated = generateRandomToken();
    var tokSheet = ss.getSheetByName(SHEET_TOKENS);
    tokSheet.appendRow([
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
    ]);
    status = "COMPLETED";
    logEvent("TOKEN_ORDER_CREATED", tokenGenerated, buyerName, "-", "-", "Lisensi terbit via pemesanan " + orderId);
  }

  // Dapatkan peta kolom Orders untuk kompatibilitas versi
  var lastCol = sheet.getLastColumn();
  var ordHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var ordColMap = getOrderColumnIndexes(ordHeaders);

  // Jika kolom Payment Proof tersedia di sheet Orders
  if (ordHeaders.length >= 14 || (ordColMap.paymentProof !== undefined && ordColMap.paymentProof === 9)) {
    sheet.appendRow([
      orderId,
      nowStr,
      buyerName,
      whatsapp,
      email,
      pkg,
      maxDevices,
      price,
      paymentMethod,
      paymentProof,
      status,
      tokenGenerated,
      fullNotes,
      nowStr
    ]);
  } else {
    // Fallback sheet lama 13 kolom
    sheet.appendRow([
      orderId,
      nowStr,
      buyerName,
      whatsapp,
      email,
      pkg,
      maxDevices,
      price,
      paymentMethod,
      status,
      tokenGenerated,
      fullNotes + (paymentProof ? " [Bukti: " + paymentProof + "]" : ""),
      nowStr
    ]);
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
    tokSheet.appendRow([
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
      "Diterbitkan dari Pemesanan " + orderId + " (" + pkg + ")"
    ]);
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
    orderFormUrl: "https://sambarangpro.github.io/keuanganku/pesan.html",
    packages: [
      { id: "pkg-personal", name: "PRO Personal (1 Perangkat)", devices: 1, price: "Rp 99.000", priceNum: 99000, description: "Untuk penggunaan pribadi di 1 HP atau 1 Laptop. Akses seumur hidup.", popular: false },
      { id: "pkg-multi", name: "PRO Multi-Device (3 Perangkat)", devices: 3, price: "Rp 149.000", priceNum: 149000, description: "Paling Populer! Sinkronisasi otomatis di HP, Laptop, dan Tablet secara hening.", popular: true },
      { id: "pkg-bisnis", name: "PRO Bisnis (5 Perangkat)", devices: 5, price: "Rp 249.000", priceNum: 249000, description: "Solusi hemat untuk keluarga / tim usaha kecil hingga 5 perangkat bersama.", popular: false },
      { id: "pkg-master", name: "PRO Developer Master (10 Perangkat)", devices: 10, price: "Rp 499.000", priceNum: 499000, description: "Akses maksimal hingga 10 perangkat untuk profesional / multi-kantor.", popular: false }
    ],
    vouchers: [
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

  var publicVouchers = (settings.vouchers || []).filter(function(v) {
    return String(v.status || "ACTIVE").toUpperCase() === "ACTIVE";
  }).map(function(v) {
    return {
      code: String(v.code || "").toUpperCase(),
      type: v.type || "fixed",
      value: Number(v.value) || 0,
      minPrice: Number(v.minPrice) || 0,
      targetPackage: v.targetPackage || "ALL",
      maxUses: Number(v.maxUses) || 0,
      usedCount: Number(v.usedCount) || 0,
      status: v.status || "ACTIVE",
      description: v.description || ""
    };
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
    vouchers: publicVouchers,
    paymentAccounts: settings.paymentAccounts || [],
    sellerWhatsApp: settings.sellerWhatsApp || "",
    orderFormUrl: settings.orderFormUrl || "",
    nextOrderSeq: nextOrderSeq,
    nextUniqueCode: nextUniqueCode
  };
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
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch(e) {
    return "[Foto Bukti: " + orderId + "]";
  }
}

function submitPublicOrder(params) {
  var buyerName = (params.buyerName || "").trim();
  var whatsapp = (params.whatsapp || "").trim();
  var email = (params.email || "").trim();
  var pkg = (params.package || "PRO Personal (1 Perangkat)").trim();
  var maxDevices = parseInt(params.maxDevices) || 1;
  var price = (params.price || "Rp 99.000").trim();
  var paymentMethod = (params.paymentMethod || "Bank Syariah Indonesia (BSI)").trim();
  var paymentProof = (params.paymentProof || "").trim();
  var voucherCode = (params.voucherCode || "").trim().toUpperCase();
  var notes = (params.notes || "").trim();

  if (!buyerName) return { success: false, message: "Nama pemesan wajib diisi." };
  if (!whatsapp) return { success: false, message: "Nomor WhatsApp aktif wajib diisi." };

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
  var uniqueCode = parseInt(params.uniqueCode, 10) || computedUniqueCode;
  var uCodePadded = (uniqueCode < 10 ? "0" : "") + uniqueCode;
  var orderId = (params.orderId && !params.orderId.includes("NaN")) ? params.orderId : ("ORD-" + dateCompact + "-" + uCodePadded);

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
    // Auto increment voucher usedCount if matched
    try {
      if (salesSettings && Array.isArray(salesSettings.vouchers)) {
        var foundVoucher = null;
        for (var vi = 0; vi < salesSettings.vouchers.length; vi++) {
          var vCode = String(salesSettings.vouchers[vi].code || "").trim().toUpperCase();
          if (vCode === voucherCode || (voucherCode === "ORANGDALAM" && vCode === "UJICOBA-PRO") || (voucherCode === "UJICOBA" && vCode === "UJICOBA-PRO")) {
            foundVoucher = salesSettings.vouchers[vi];
            foundVoucher.usedCount = (Number(foundVoucher.usedCount) || 0) + 1;
            break;
          }
        }
        if (foundVoucher) {
          PropertiesService.getScriptProperties().setProperty("KEUANGANKU_SALES_SETTINGS", JSON.stringify(salesSettings));
        }
      }
    } catch(errVoucher) {}
  }
  if (!fullNotes.includes("Kode Unik")) {
    fullNotes = (fullNotes ? fullNotes + " | " : "") + modeTag + "Kode Unik: " + uCodePadded + " (Urutan #" + orderSeq + ")";
  }

  var isPioneerVoucher = (voucherCode === "UJICOBA-PRO" || voucherCode === "ORANGDALAM" || voucherCode === "UJICOBA");
  var isZeroPrice = (price === "Rp 0" || price === "0" || price === "Rp0" || price === 0);
  var isExistingToken = (voucherCode.startsWith("PRO-") || (voucherCode.startsWith("PRO") && voucherCode.length >= 8));

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
      tokSheet.appendRow([
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
      ]);

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
    sheet.appendRow([
      orderId,
      nowStr,
      buyerName,
      whatsapp,
      email,
      pkg,
      maxDevices,
      price,
      paymentMethod,
      paymentProof,
      orderStatus,
      tokenGenerated,
      fullNotes,
      nowStr
    ]);
  } else {
    sheet.appendRow([
      orderId,
      nowStr,
      buyerName,
      whatsapp,
      email,
      pkg,
      maxDevices,
      price,
      paymentMethod,
      orderStatus,
      tokenGenerated,
      fullNotes + (paymentProof ? " [Bukti: " + paymentProof + "]" : ""),
      nowStr
    ]);
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
    if (params.vouchers) current.vouchers = typeof params.vouchers === 'string' ? JSON.parse(params.vouchers) : params.vouchers;
  } catch(e) {}
  try {
    if (params.paymentAccounts) current.paymentAccounts = typeof params.paymentAccounts === 'string' ? JSON.parse(params.paymentAccounts) : params.paymentAccounts;
  } catch(e) {}
  if (params.sellerWhatsApp !== undefined) current.sellerWhatsApp = String(params.sellerWhatsApp).trim();
  if (params.orderFormUrl !== undefined) current.orderFormUrl = String(params.orderFormUrl).trim();
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
