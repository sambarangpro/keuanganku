# Panduan Pasang Pembaruan Keamanan (November 2026)

Pembaruan ini menutup beberapa celah: data keuangan bisa dibaca orang lain, lisensi bisa didapat
gratis, dan akun pembeli bisa diambil alih. Ada **dua server Google** yang perlu dipasang ulang
secara manual. Kerjakan berurutan dari atas ke bawah.

> Paling mudah dikerjakan dari **laptop**. Halaman Apps Script sulit dipakai di HP atau iPad.

---

## Langkah 1 — Perbarui aplikasi di semua perangkat

1. Setelah kode baru tersimpan di GitHub, tunggu 1–2 menit.
2. Buka aplikasi KEUANGANKU di **setiap** perangkat (HP, laptop, iPad).
3. Kalau muncul tombol **"Perbarui"**, tekan tombol itu.

Aplikasi versi baru tetap bisa dipakai dengan server lama, jadi langkah ini aman dikerjakan lebih dulu.

## Langkah 2 — Pasang ulang Server Lisensi

1. Buka https://script.google.com, lalu pilih proyek **server lisensi**. Ciri-cirinya: berisi fungsi
   `validateClientToken`, `adminGetData`, dan sebagainya.
2. Buka file kode utamanya (biasanya `Code.gs`), lalu **hapus semua isinya**.
3. Salin seluruh isi file `master-backend-gas.js` terbaru dari GitHub (tombol "Raw", lalu pilih semua
   dan salin), kemudian tempel ke editor.
4. Tekan **Simpan** (ikon disket).
5. Tekan **Terapkan (Deploy) → Kelola penerapan** → ikon pensil (Edit) → ubah **Versi** menjadi
   **Versi baru** → **Terapkan**.
6. Kalau Google meminta izin, pilih akun Anda lalu tekan **Izinkan**.

Alamat (URL) server **tidak berubah**, jadi tidak ada yang perlu diubah di aplikasi.

## Langkah 3 — Ganti kata sandi Developer Dashboard (WAJIB)

Kata sandi bawaan tercantum di kode yang publik, jadi siapa pun bisa melihatnya.

1. Buka `dev-dashboard.html`, lalu login.
2. Buka menu **Ganti Password**, lalu buat kata sandi baru **minimal 10 karakter**.

Kata sandi baru disimpan di Script Properties dan tidak ikut terunggah ke GitHub.

## Langkah 4 — (Jika perlu) Daftarkan email Google pemilik

Login dengan Google ke token pemilik kini hanya menerima email yang **persis sama**.
Kalau Anda memakai email Google lain, daftarkan di Apps Script server lisensi:

**Setelan proyek (ikon roda gigi) → Properti skrip → Tambahkan properti**

| Properti       | Nilai (contoh)                                  |
|----------------|-------------------------------------------------|
| `OWNER_EMAILS` | `emailanda@gmail.com,email-lain@gmail.com`      |
| `OWNER_TOKENS` | (opsional) daftar token pemilik, pisahkan dengan koma |

## Langkah 5 — Kunci Server Cloud data keuangan

Server cloud adalah Apps Script yang menempel di Google Sheet database keuangan Anda.

1. Di aplikasi, buka **Setup → Sinkronisasi Google Drive → "Amankan Cloud Script"**.
2. Tekan **SALIN KODE SCRIPT**. Kode ini berisi **kunci rahasia**, jadi jangan dibagikan ke siapa pun.
3. Buka Google Sheet database keuangan Anda, lalu pilih **Ekstensi → Apps Script**.
4. Hapus semua kode lama, lalu tempel kode yang baru disalin dan tekan **Simpan**.
5. Tekan **Terapkan → Kelola penerapan → Edit → Versi baru → Terapkan**.
6. Kembali ke aplikasi. Pastikan kolom **Link Web App** sudah terisi, lalu tekan **AKTIFKAN KUNCI**.
7. Tunggu sampai muncul **"✓ Kunci aktif!"**.

Kerjakan langkah ini di **satu perangkat saja**. Perangkat lain akan otomatis mendapat kunci yang
sama saat aplikasi dibuka.

## Langkah 6 — Ganti PIN aplikasi

PIN lama sempat terbuka untuk umum, jadi buat PIN baru di **Setup → PIN Pribadi**.

---

## Kalau ada masalah

| Gejala | Solusi |
|---|---|
| Ikon cloud menampilkan **"Kunci Cloud Salah"** | Buka aplikasi di perangkat tempat Anda menekan "Aktifkan Kunci", lalu buka perangkat yang bermasalah sekali lagi. Kalau masih salah, masuk ulang dengan Google atau dengan Token + PIN. |
| Scan QR gagal: **"HP ini belum terdaftar"** | Di HP utama, masuk ulang dengan Token + PIN (atau Google) satu kali, lalu scan lagi. |
| Login Dev Dashboard **"dikunci 15 menit"** | Ada 10 kali salah kata sandi. Tunggu 15 menit. |
| Pembeli: **"PIN pribadi belum tercatat di server"** | Pembeli menautkan perangkat lewat Scan QR dari HP utamanya, atau developer mereset token dari Dashboard. |
