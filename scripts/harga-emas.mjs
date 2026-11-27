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

async function main() {
  const res = await fetch(URL_SUMBER, { headers: { 'User-Agent': 'Mozilla/5.0 (KeuangankuPRO harga-emas bot)', 'Accept': 'text/html' } });
  if (!res.ok) throw new Error('Gagal mengambil ' + URL_SUMBER + ': HTTP ' + res.status);
  const vendors = parseGaleri24(await res.text());
  if (vendors.length < 3 || !vendors.some(v => v.name === 'ANTAM')) throw new Error('Format halaman berubah, hanya ' + vendors.length + ' merek terbaca');
  let old = null;
  if (existsSync(FILE)) { try { old = JSON.parse(readFileSync(FILE, 'utf8')); } catch (e) {} }
  if (old && JSON.stringify(old.vendors) === JSON.stringify(vendors)) { console.log('Harga tidak berubah (' + vendors.length + ' merek).'); return; }
  const out = { source: 'Galeri 24 (PT Pegadaian Galeri 24)', sourceUrl: URL_SUMBER, updatedAt: new Date().toISOString(), vendors };
  writeFileSync(FILE, JSON.stringify(out, null, 1) + '\n');
  console.log('Harga diperbarui: ' + vendors.length + ' merek.');
}

if (process.argv[1] && process.argv[1].endsWith('harga-emas.mjs')) main().catch(e => { console.error(e.message); process.exit(1); });
