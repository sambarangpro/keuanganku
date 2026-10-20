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

// Nama sheet penyimpanan
var SHEET_TOKENS = "Tokens";
var SHEET_LOGS = "Logs";

/**
 * Inisialisasi otomatis struktur sheet jika belum ada atau update kolom
 */
function initSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // Sheet Tokens
  var tokensSheet = ss.getSheetByName(SHEET_TOKENS);
  if (!tokensSheet) {
    tokensSheet = ss.insertSheet(SHEET_TOKENS);
    tokensSheet.appendRow([
      "Token", "Buyer Name", "Buyer Contact", "Max Devices", 
      "Device Count", "Used Devices (JSON)", "Status", "PIN Status", "Personal PIN", "Created At", "Notes"
    ]);
    tokensSheet.getRange("A1:K1").setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
    tokensSheet.setFrozenRows(1);
  } else {
    // Pastikan header memiliki kolom PIN Status jika sheet lama
    var lastCol = tokensSheet.getLastColumn();
    if (lastCol < 11) {
      tokensSheet.getRange(1, 8).setValue("PIN Status");
      tokensSheet.getRange(1, 9).setValue("Personal PIN");
      tokensSheet.getRange(1, 10).setValue("Created At");
      tokensSheet.getRange(1, 11).setValue("Notes");
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
}

function doGet(e) {
  return handleRequest(e ? e.parameter : {});
}

function doPost(e) {
  var params = {};
  if (e && e.postData && e.postData.contents) {
    try {
      params = JSON.parse(e.postData.contents);
    } catch(err) {
      params = e.parameter || {};
    }
  } else if (e && e.parameter) {
    params = e.parameter;
  }
  return handleRequest(params);
}

function handleRequest(params) {
  initSheets();
  var action = params.action || "";
  var result = { success: false, message: "Action tidak dikenal" };

  try {
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

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();

  var cleanInputToken = tokenInput.replace(/[^A-Z0-9]/g, '');

  for (var i = 1; i < data.length; i++) {
    var rowToken = String(data[i][0]).trim().toUpperCase();
    var cleanRowToken = rowToken.replace(/[^A-Z0-9]/g, '');

    if (rowToken === tokenInput || (cleanInputToken && cleanRowToken === cleanInputToken)) {
      tokenInput = rowToken; // Gunakan format resmi canonical (dengan tanda strip)
      var buyerName = data[i][1];
      var maxDevices = parseInt(data[i][3]) || 2;
      // Berikan batas kuota prioritas pemilik/developer akun agar bebas multi-perangkat saat pengujian
      if (tokenInput === 'PRO-S8GF-HQT5-CNVE' || String(buyerName).toLowerCase().includes('akbar')) {
        maxDevices = Math.max(maxDevices, 10);
      }
      var status = String(data[i][6]).trim().toUpperCase();
      var pinStatus = String(data[i][7] || "UNCLAIMED").trim().toUpperCase();
      var storedPersonalPin = String(data[i][8] || "").trim();
      var rawDevices = data[i][5];

      var devices = [];
      try { devices = rawDevices ? JSON.parse(rawDevices) : []; } catch(e) { devices = []; }

      // Normalisasi jika pinStatus belum terisi di baris sheet lama
      if (pinStatus !== "PIN_CHANGED" && storedPersonalPin) {
        pinStatus = "PIN_CHANGED";
      } else if (pinStatus !== "PIN_CHANGED" && devices.length > 0) {
        pinStatus = "USING_TOKEN";
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
      if (pinStatus === "PIN_CHANGED") {
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

      // 3. Cek apakah perangkat sudah ada (Re-login)
      if (existingDevice) {
        existingDevice.lastActive = new Date().toISOString();
        existingDevice.deviceName = deviceName;
        sheet.getRange(i + 1, 6).setValue(JSON.stringify(devices));

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
            activatedAt: existingDevice.activatedAt
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

      sheet.getRange(i + 1, 5).setValue(devices.length);
      sheet.getRange(i + 1, 6).setValue(JSON.stringify(devices));
      sheet.getRange(i + 1, 8).setValue(newPinStatus);

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
          activatedAt: newDevObj.activatedAt
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
    return { success: false, status: "EXPIRED", message: "Sesi barcode telah kedaluwarsa. Silakan muat ulang barcode." };
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
  if (!raw) {
    return { success: false, message: "Sesi barcode di layar PC/iPad telah kedaluwarsa. Silakan muat ulang barcode di PC/iPad." };
  }

  var sessionObj = JSON.parse(raw);
  var targetDeviceId = sessionObj.deviceId || ("DEV-" + Date.now().toString(36).toUpperCase());
  var targetDeviceName = sessionObj.deviceName || "Perangkat Tambahan";

  // Validasi lisensi di Spreadsheet Tokens
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();
  var cleanInputToken = tokenInput.replace(/[^A-Z0-9]/g, '');

  var foundRow = -1;
  var rowData = null;

  for (var i = 1; i < data.length; i++) {
    var rowToken = String(data[i][0]).trim().toUpperCase();
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

  var buyerName = rowData[1];
  var maxDevices = parseInt(rowData[3]) || 2;
  var status = String(rowData[6]).trim().toUpperCase();
  var pinStatus = String(rowData[7] || "UNCLAIMED").trim().toUpperCase();
  var storedPersonalPin = String(rowData[8] || "").trim();
  var rawDevices = rowData[5];

  // Prioritas Kuota Developer / Pemilik Akun
  if (tokenInput === 'PRO-S8GF-HQT5-CNVE' || String(buyerName).toLowerCase().includes('akbar')) {
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
  sheet.getRange(foundRow, 5).setValue(devices.length);
  sheet.getRange(foundRow, 6).setValue(JSON.stringify(devices));

  logEvent("PAIR_SESSION_AUTHORIZED", tokenInput, buyerName, targetDeviceId, targetDeviceName, "Perangkat berhasil ditautkan via Scan HP WhatsApp Style");

  // Update session di cache Google Apps Script agar PC/iPad langsung otomatis login
  sessionObj.status = "AUTHORIZED";
  sessionObj.licenseData = {
    token: tokenInput,
    buyerName: buyerName,
    pinStatus: pinStatus,
    isPasswordChanged: (pinStatus === "PIN_CHANGED"),
    maxDevices: maxDevices,
    deviceCount: devices.length
  };
  sessionObj.pin = inputPin || storedPersonalPin || "";
  sessionObj.masterUrl = params.masterUrl || "";

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

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();

  var cleanInputToken = tokenInput.replace(/[^A-Z0-9]/g, '');

  for (var i = 1; i < data.length; i++) {
    var rowToken = String(data[i][0]).trim().toUpperCase();
    var cleanRowToken = rowToken.replace(/[^A-Z0-9]/g, '');
    if (rowToken === tokenInput || (cleanInputToken && cleanRowToken === cleanInputToken)) {
      tokenInput = rowToken;
      var buyerName = data[i][1];

      // Update PIN Status menjadi PIN_CHANGED (Token Hangus) & simpan PIN Pribadi
      sheet.getRange(i + 1, 8).setValue("PIN_CHANGED");
      sheet.getRange(i + 1, 9).setValue(newPin);

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

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === tokenInput) {
      var status = String(data[i][6]).trim().toUpperCase();
      var pinStatus = String(data[i][7] || "UNCLAIMED").trim().toUpperCase();

      if (status !== "ACTIVE") {
        return { success: true, active: false, reason: "BLOCKED", message: "Lisensi ini telah dinonaktifkan." };
      }

      var rawDevices = data[i][5];
      var devices = [];
      try { devices = rawDevices ? JSON.parse(rawDevices) : []; } catch(e) {}

      var storedPersonalPin = String(data[i][8] || "").trim();
      if (pinStatus !== "PIN_CHANGED" && storedPersonalPin) pinStatus = "PIN_CHANGED";
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

      return { 
        success: true, 
        active: true, 
        buyerName: data[i][1],
        pinStatus: pinStatus,
        isPasswordChanged: (pinStatus === "PIN_CHANGED"),
        deviceCount: devices.length,
        maxDevices: parseInt(data[i][3]) || 2
      };
    }
  }

  return { success: true, active: false, reason: "NOT_FOUND", message: "Token tidak terdaftar." };
}

function clientGetDevices(params) {
  var tokenInput = (params.token || "").trim().toUpperCase();
  var currentDeviceId = (params.deviceId || "").trim();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === tokenInput) {
      var buyerName = data[i][1];
      var status = String(data[i][6]).trim().toUpperCase();
      if (status !== "ACTIVE") {
        return { success: false, message: "Lisensi ini telah dinonaktifkan." };
      }

      var rawDevices = data[i][5];
      var devices = [];
      try { devices = rawDevices ? JSON.parse(rawDevices) : []; } catch(e) {}

      var maxDevices = parseInt(data[i][3]) || 2;
      // Berikan batas kuota prioritas pemilik/developer akun agar bebas multi-perangkat saat pengujian
      if (tokenInput === 'PRO-S8GF-HQT5-CNVE' || String(buyerName).toLowerCase().includes('akbar')) {
        maxDevices = Math.max(maxDevices, 10);
      }
      var pinStatus = String(data[i][7] || "UNCLAIMED").trim().toUpperCase();
      var storedPersonalPin = String(data[i][8] || "").trim();

      if (pinStatus !== "PIN_CHANGED" && storedPersonalPin) pinStatus = "PIN_CHANGED";
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

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === tokenInput) {
      var buyerName = data[i][1];
      var rawDevices = data[i][5];
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

      sheet.getRange(i + 1, 5).setValue(updated.length);
      sheet.getRange(i + 1, 6).setValue(JSON.stringify(updated));

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

function checkAdminAuth(password) {
  return (password && String(password).trim() === MASTER_ADMIN_PASSWORD);
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

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();

  var tokensList = [];
  var totalDevicesActive = 0;
  var totalActiveTokens = 0;
  var totalBlockedTokens = 0;
  var totalPinChanged = 0;
  var totalUsingToken = 0;
  var totalUnclaimed = 0;

  for (var i = 1; i < data.length; i++) {
    var rawDev = data[i][5];
    var parsedDev = [];
    try { parsedDev = rawDev ? JSON.parse(rawDev) : []; } catch(e) {}

    var st = String(data[i][6]).trim().toUpperCase();
    var pinSt = String(data[i][7] || "UNCLAIMED").trim().toUpperCase();
    var storedPersonalPin = String(data[i][8] || "").trim();

    // Normalisasi cerdas: jika ada device aktif dan belum ganti PIN pribadi, statusnya USING_TOKEN
    var isPinChanged = (pinSt === "PIN_CHANGED") || (storedPersonalPin !== "");
    var isUsingToken = !isPinChanged && (pinSt === "USING_TOKEN" || parsedDev.length > 0);
    var effectivePinStatus = isPinChanged ? "PIN_CHANGED" : (isUsingToken ? "USING_TOKEN" : "UNCLAIMED");

    if (st === "ACTIVE") totalActiveTokens++;
    else if (st === "BLOCKED") totalBlockedTokens++;

    if (effectivePinStatus === "PIN_CHANGED") totalPinChanged++;
    else if (effectivePinStatus === "USING_TOKEN") totalUsingToken++;
    else totalUnclaimed++;

    totalDevicesActive += parsedDev.length;

    tokensList.push({
      token: String(data[i][0] || ''),
      buyerName: String(data[i][1] || ''),
      buyerContact: String(data[i][2] || ''),
      maxDevices: parseInt(data[i][3]) || 2,
      deviceCount: parsedDev.length,
      usedDevices: parsedDev,
      status: st,
      pinStatus: effectivePinStatus,
      createdAt: String(data[i][9] || data[i][7] || "-"),
      notes: String(data[i][10] || data[i][8] || "")
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
    recentLogs: recentLogs
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

  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === token) {
      sheet.getRange(i + 1, 5).setValue(0); // device count reset
      sheet.getRange(i + 1, 6).setValue(JSON.stringify([])); // clear devices
      sheet.getRange(i + 1, 7).setValue("ACTIVE");
      sheet.getRange(i + 1, 8).setValue("USING_TOKEN"); // Kembalikan ke token bawaan
      sheet.getRange(i + 1, 9).setValue(""); // hapus PIN pribadi lama

      logEvent("TOKEN_REACTIVATED", token, data[i][1], "-", "-", "Developer mengaktifkan kembali token & mereset perangkat.");
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === token) {
      sheet.getRange(i + 1, 5).setValue(0);
      sheet.getRange(i + 1, 6).setValue(JSON.stringify([]));
      logEvent("DEVICES_RESET", token, data[i][1], "-", "-", "Slot perangkat direset oleh Developer.");
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

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_TOKENS);
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === token) {
      var buyerName = data[i][1];
      var rawDevices = data[i][5];
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

      sheet.getRange(i + 1, 5).setValue(updated.length);
      sheet.getRange(i + 1, 6).setValue(JSON.stringify(updated));
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

  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
  var ss = SpreadsheetApp.getActiveSpreadsheet();
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
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_LOGS);
    if (!sheet) return;
    var nowStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([nowStr, event, token, buyerName, deviceId, deviceName, details]);
  } catch(e) {}
}
