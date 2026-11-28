// Ambil harga emas batangan (jual & buyback) semua merek dari halaman resmi Galeri 24 (PT Pegadaian Galeri 24)
// lalu simpan ke harga-emas.json. File hanya ditulis ulang bila harganya berubah.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const URL_SUMBER = 'https://galeri24.co.id/harga-emas';
const FILE = 'harga-emas.json';

export function parseGaleri24(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const L = text.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const rp = s => { const m = /^Rp\s?([\d.]+)$/.exec(s); return m ? Number(m[1].replace(/\./g, '')) : null; };
  const vendors = [];
  let date = '';
  for (let i = 0; i < L.length; i++) {
    if (L[i].startsWith('Diperbarui ')) { date = L[i].slice(11).trim(); continue; }
    if (L[i].startsWith('Harga ') && L[i + 1] === 'Berat' && L[i + 2] === 'Harga Jual' && L[i + 3] === 'Harga Buyback') {
      const name = L[i].slice(6).replace(/\s+-\s+.*$/, '').trim();
      const items = [];
      let j = i + 4;
      while (j + 2 < L.length && /^\d+(\.\d+)?$/.test(L[j]) && rp(L[j + 1]) !== null && rp(L[j + 2]) !== null) {
        items.push({ g: Number(L[j]), jual: rp(L[j + 1]) || null, buyback: rp(L[j + 2]) || null });
        j += 3;
      }
      if (items.length) vendors.push({ name, date, items });
      i = j - 1;
    }
  }
  return vendors;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const angka = s => Number(String(s).replace(/[^\d]/g, ''));

// Harga beli perak fisik dari halaman publik Logam Mulia (ANTAM). Halaman dirender di browser, jadi dibaca dengan Playwright.
async function perakLogamMulia() {
  let pw;
  try { pw = await import('playwright'); } catch (e) { console.log('Playwright tidak tersedia, perak Logam Mulia dilewati.'); return null; }
  const browser = await pw.chromium.launch();
  let page = null;
  try {
    page = await browser.newPage({ userAgent: UA, locale: 'id-ID', timezoneId: 'Asia/Jakarta' });
    await page.goto('https://logammulia.com/harga-hari-ini/perak', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => /Perak Fisik[\s\S]{0,40}Rp\s?[\d.,]+\s*\/gr/.test(document.body.innerText), null, { timeout: 45000 });
    const t = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
    const m = /Perak Fisik Rp\s?([\d.,]+)\s*\/gr/.exec(t);
    const d = /Terakhir diperbarui\s+(.+?)\s*\|\s*([\d:.]+)\s*WIB/.exec(t);
    if (!m) return null;
    return { source: 'Logam Mulia (ANTAM)', sourceUrl: 'https://logammulia.com/harga-hari-ini/perak', beliPerGram: angka(m[1]), date: d ? d[1].trim() + ' ' + d[2] + ' WIB' : '' };
  } catch (e) {
    let info = '';
    try { info = ' | judul: ' + (await page.title()) + ' | isi: ' + (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300); } catch (er) {}
    console.log('Perak Logam Mulia gagal: ' + e.message.split('\n')[0] + info);
    return null;
  }
  finally { await browser.close(); }
}

// Harga perak dunia (spot) dikonversi ke rupiah per gram
async function perakDunia() {
  try {
    const x = await (await fetch('https://api.gold-api.com/price/XAG', { headers: { 'User-Agent': UA } })).json();
    const k = await (await fetch('https://open.er-api.com/v6/latest/USD')).json();
    const usdOz = Number(x && x.price), idr = Number(k && k.rates && k.rates.IDR);
    if (!(usdOz > 0) || !(idr > 0)) return null;
    return { source: 'Harga perak dunia (XAG/USD) x kurs USD/IDR', usdPerOunce: usdOz, kursIdr: idr, perGram: Math.round(usdOz / 31.1034768 * idr), date: new Date().toISOString().slice(0, 10) };
  } catch (e) { console.log('Perak dunia gagal: ' + e.message); return null; }
}

async function main() {
  const res = await fetch(URL_SUMBER, { headers: { 'User-Agent': 'Mozilla/5.0 (KeuangankuPRO harga-emas bot)', 'Accept': 'text/html' } });
  if (!res.ok) throw new Error('Gagal mengambil ' + URL_SUMBER + ': HTTP ' + res.status);
  const vendors = parseGaleri24(await res.text());
  if (vendors.length < 3 || !vendors.some(v => v.name === 'ANTAM')) throw new Error('Format halaman berubah, hanya ' + vendors.length + ' merek terbaca');
  let old = null;
  if (existsSync(FILE)) { try { old = JSON.parse(readFileSync(FILE, 'utf8')); } catch (e) {} }
  const lm = await perakLogamMulia(), spot = await perakDunia();
  const perak = { logamMulia: lm || (old && old.perak && old.perak.logamMulia) || null, dunia: spot || (old && old.perak && old.perak.dunia) || null };
  console.log('Perak Logam Mulia: ' + (lm ? lm.beliPerGram : 'gagal') + ' | Perak dunia: ' + (spot ? spot.perGram : 'gagal'));
  const sama = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const kunciPerak = p => p ? [p.logamMulia && p.logamMulia.beliPerGram, p.logamMulia && p.logamMulia.date, p.dunia && Math.round(p.dunia.perGram / 250)] : null;
  if (old && sama(old.vendors, vendors) && sama(kunciPerak(old.perak), kunciPerak(perak))) { console.log('Harga tidak berubah (' + vendors.length + ' merek).'); return; }
  const out = { source: 'Galeri 24 (PT Pegadaian Galeri 24)', sourceUrl: URL_SUMBER, updatedAt: new Date().toISOString(), vendors, perak };
  writeFileSync(FILE, JSON.stringify(out, null, 1) + '\n');
  console.log('Harga diperbarui: ' + vendors.length + ' merek.');
}

if (process.argv[1] && process.argv[1].endsWith('harga-emas.mjs')) main().catch(e => { console.error(e.message); process.exit(1); });
