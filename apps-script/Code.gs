/**
 * Zippo Collection — API trên Google Apps Script.
 * Đọc sheet "Data Zippo", ghi vào sheet "Zippo", ảnh trong thư mục "Anh Zippo".
 *
 * Cài đặt: xem README.md trong repo (mục "Cài phần máy chủ").
 *
 * MẬT KHẨU: lần đầu, gõ mật khẩu vào dòng OWNER_PASSWORD bên dưới rồi chạy hàm setup.
 * Mật khẩu được cất vào phần cài đặt riêng của script (không ai xem được), nên các lần
 * cập nhật code sau anh chỉ việc dán code mới, KHÔNG cần gõ lại mật khẩu.
 * (Không ghi mật khẩu thật lên GitHub vì repo để công khai.)
 */

// Để trống = dùng mật khẩu đã cất. Muốn đổi mật khẩu: gõ mật khẩu mới vào đây và chạy setup.
const OWNER_PASSWORD = '';

const SPREADSHEET_ID = '1OjKbmFyFQUGcXwG6HKYbfwo7Hl2eYJAqqQHYpZ9Xkag';
const PHOTO_FOLDER_ID = '11FN4LKbkDKuGYvTdlA47jtNa52Nkk6-b';
const SHEET_INPUT = 'Zippo';
const SHEET_DATA = 'Data Zippo';
const SHEET_LISTS = 'Danh mục';
const FIRST_ROW = 3; // dữ liệu sheet Zippo bắt đầu từ dòng 3

const DEFAULT_CASES = ['R', 'Armor', 'Slim', 'Slim Armor', 'Rep.32', 'Rep.33', 'Time Tank', 'Rep.37', 'Rep.41', 'Rep.35'];
const DEFAULT_FINISHES = ['High Polish Chrome', 'Brushed Chrome', 'Satin Chrome', 'Black Ice', 'Midnight Chrome', 'Sapphire',
  'Matte', 'Crackle', 'High Polish Brass', 'Brushed Brass', 'Antique Brass', 'Antique Silver', 'Antique Copper', 'Copper',
  'Sterling Silver', 'Maki-e', 'Urushi Lacquer'];
const DEFAULT_CONDITIONS = ['New', 'Used'];

// Các cột được tìm theo TIÊU ĐỀ (dòng 1–2 của sheet Zippo, dòng 1 của Data Zippo), nên anh chèn
// thêm cột mới vào sheet thì web vẫn chạy đúng. [tên trường, dòng tiêu đề, chữ trong tiêu đề]
const INPUT_HEADERS = [
  ['no', 1, 'No.'], ['name', 1, 'Name'], ['sku', 1, 'SKU'], ['caseType', 1, 'Case'], ['finish', 1, 'Finish'],
  ['left', 2, 'Left'], ['right', 2, 'Right'], ['qlt', 2, 'QLT'], ['price', 2, 'Price'], ['date', 2, 'Date'],
  ['caseCond', 2, 'Case'], ['insertsCond', 2, 'Inserts'], ['buyFrom', 1, 'Buy From'], ['origin', 1, 'Country of origin'],
  ['note', 1, 'Note'], ['collection', 1, 'Collection'], ['pic', 2, 'Pic'],
];
const DATA_HEADERS = {
  no: 'No.', name: 'Name', sku: 'SKU', caseType: 'Case', finish: 'Finish', code: 'Code', codeYear: 'Code Year',
  price: 'Price', date: 'Date Purchse|Date Purchase', yearPurchase: 'Year Purchse|Year Purchase', caseCond: 'Case cond.',
  insertsCond: 'Inserts Cond.', buyFrom: 'Buy From', origin: 'Country of origin', note: 'Note', collection: 'Collection',
};
const norm_ = function (v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(); };

// Bố cục sheet Zippo: {col: {tên trường: số cột}, formulaCols, inputCols}
function layout_(sheet) {
  const width = sheet.getLastColumn();
  const head = sheet.getRange(1, 1, 2, width).getValues();
  const col = {};
  const used = {};
  INPUT_HEADERS.forEach(function (h) {
    for (let c = 0; c < width; c++) {
      if (!used[c] && norm_(head[h[1] - 1][c]) === norm_(h[2])) { col[h[0]] = c + 1; used[c] = true; break; }
    }
  });
  ['no', 'name', 'left', 'right', 'price', 'date'].forEach(function (k) {
    if (!col[k]) throw new Error('Không tìm thấy cột "' + k + '" trong sheet Zippo — anh kiểm tra lại tiêu đề cột nhé.');
  });
  // Vùng dữ liệu kết thúc ở cột "Pic" + 2 cột công thức (Code, giá × 1000); bên phải là bảng tra mã năm
  const lastCol = Math.min(width, (col.pic || width) + 2);
  const formulas = sheet.getRange(FIRST_ROW, 1, 1, lastCol).getFormulas()[0];
  const formulaCols = [];
  const inputCols = [];
  for (let c = 1; c <= lastCol; c++) (formulas[c - 1] ? formulaCols : inputCols).push(c);
  return { col: col, formulaCols: formulaCols, inputCols: inputCols };
}

// Vị trí cột trong Data Zippo theo tiêu đề dòng 1 (0 = A)
function dataCols_(headerRow) {
  const idx = {};
  Object.keys(DATA_HEADERS).forEach(function (k) {
    const names = DATA_HEADERS[k].split('|').map(norm_);
    for (let c = 0; c < headerRow.length; c++) if (names.indexOf(norm_(headerRow[c])) >= 0) { idx[k] = c; break; }
  });
  return idx;
}

// ---------- Cổng vào ----------

function doGet(e) {
  return handle_(function () {
    const p = (e && e.parameter) || {};
    if (p.action === 'ping') return { ok: true };
    // Khách xem qua GET; chủ đọc qua POST (action "list") để mật khẩu không nằm trên đường link
    return { ok: true, owner: false, items: readItems_(false), lists: readLists_(), files: photoFiles_(), updated: new Date().toISOString() };
  });
}

function doPost(e) {
  return handle_(function () {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!isOwner_(body.key)) throw new Error('Sai mật khẩu chủ sở hữu.');
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      switch (body.action) {
        case 'login': return { ok: true, owner: true };
        case 'list': return { ok: true, owner: true, items: readItems_(true), lists: readLists_(), files: photoFiles_(), updated: new Date().toISOString() };
        case 'save': return { ok: true, item: saveItem_(body.item || {}) };
        case 'delete': return { ok: true, no: deleteItem_(body.no) };
        case 'uploadPhoto': return { ok: true, photo: uploadPhoto_(body.no, body.data, body.mime) };
        case 'deletePhoto': return { ok: true, photos: deletePhoto_(body.no, body.id) };
        case 'setMainPhoto': return { ok: true, photos: setMainPhoto_(body.no, body.id) };
        default: throw new Error('Không rõ thao tác: ' + body.action);
      }
    } finally {
      lock.releaseLock();
    }
  });
}

function handle_(fn) {
  let out;
  try { out = fn(); } catch (err) { out = { ok: false, error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function ownerPassword_() {
  const props = PropertiesService.getScriptProperties();
  if (OWNER_PASSWORD) {
    if (props.getProperty('OWNER_PASSWORD') !== OWNER_PASSWORD) props.setProperty('OWNER_PASSWORD', OWNER_PASSWORD);
    return OWNER_PASSWORD;
  }
  return props.getProperty('OWNER_PASSWORD') || '';
}

function isOwner_(key) {
  const pass = ownerPassword_();
  return !!key && !!pass && String(key) === pass;
}

// ---------- Đọc dữ liệu ----------

function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function readItems_(owner) {
  const ss = ss_();
  const data = ss.getSheetByName(SHEET_DATA).getDataRange().getValues();
  const D = dataCols_(data[0]);
  const v = function (r, k) { return D[k] == null ? '' : r[D[k]]; };
  let codes = [];
  if (owner) {
    const input = ss.getSheetByName(SHEET_INPUT);
    const L = layout_(input).col;
    const n = Math.max(data.length - 1, 1);
    const left = input.getRange(FIRST_ROW, L.left, n, 1).getDisplayValues();
    const right = input.getRange(FIRST_ROW, L.right, n, 1).getDisplayValues();
    codes = left.map(function (r, i) { return [r[0], right[i][0]]; });
  }
  const photos = photoMap_();
  const tz = ss.getSpreadsheetTimeZone();
  const items = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const name = clean_(v(r, 'name'));
    const no = Number(v(r, 'no'));
    if (!name || !no) continue;
    const item = {
      no: no,
      name: name,
      sku: clean_(v(r, 'sku')),
      caseType: clean_(v(r, 'caseType')),
      finish: clean_(v(r, 'finish')),
      code: clean_(v(r, 'code')) === '-' ? '' : clean_(v(r, 'code')),
      codeYear: num_(v(r, 'codeYear')),
      collection: clean_(v(r, 'collection')),
      photos: (photos[no] || []).map(function (f) { return f.id; }),
    };
    if (owner) {
      item.left = codes[i - 1] ? codes[i - 1][0] : '';
      item.right = codes[i - 1] ? codes[i - 1][1] : '';
      item.price = num_(v(r, 'price'));
      // Ô ngày trống trong sheet hiện ra là năm 1899/1900 — coi như chưa có
      const rawDate = v(r, 'date');
      const d = rawDate instanceof Date && rawDate.getFullYear() > 1950 ? rawDate : null;
      item.date = d ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '';
      const y = num_(v(r, 'yearPurchase'));
      item.yearPurchase = item.date ? Number(item.date.slice(0, 4)) : (y && y > 1950 ? y : null);
      item.caseCond = clean_(v(r, 'caseCond'));
      item.insertsCond = clean_(v(r, 'insertsCond'));
      item.buyFrom = clean_(v(r, 'buyFrom'));
      item.origin = clean_(v(r, 'origin'));
      item.note = clean_(v(r, 'note'));
    }
    items.push(item);
  }
  return items;
}

function clean_(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return /^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NUM!|ERROR!)$/.test(s) || s === '0' ? '' : s;
}

function num_(v) {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
  return v === '' || v === null || isNaN(n) || n === 0 ? null : n;
}

// Danh sách chọn cho form thêm/sửa — anh tự sửa trong sheet "Danh mục"
function readLists_() {
  const sh = listsSheet_();
  const values = sh.getDataRange().getValues();
  const col = function (i) {
    return values.slice(1).map(function (r) { return clean_(r[i]); }).filter(String);
  };
  return { cases: col(0), finishes: col(1), conditions: col(2) };
}

function listsSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEET_LISTS);
  if (sh) return sh;
  sh = ss.insertSheet(SHEET_LISTS);
  const n = Math.max(DEFAULT_CASES.length, DEFAULT_FINISHES.length);
  const rows = [['Case', 'Finish', 'Tình trạng']];
  for (let i = 0; i < n; i++) rows.push([DEFAULT_CASES[i] || '', DEFAULT_FINISHES[i] || '', DEFAULT_CONDITIONS[i] || '']);
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

// ---------- Ghi dữ liệu ----------

// [[No., Tên], …] từ dòng 3 trở xuống
function noNames_(sheet, L) {
  const n = Math.max(sheet.getLastRow() - FIRST_ROW + 1, 1);
  const nos = sheet.getRange(FIRST_ROW, L.col.no, n, 1).getValues();
  const names = sheet.getRange(FIRST_ROW, L.col.name, n, 1).getValues();
  return nos.map(function (r, i) { return [r[0], names[i][0]]; });
}

function findRow_(sheet, L, no) {
  const rows = noNames_(sheet, L);
  for (let i = 0; i < rows.length; i++) {
    if (Number(rows[i][0]) === Number(no) && String(rows[i][1]).trim()) return FIRST_ROW + i;
  }
  return 0;
}

// Dòng trống đầu tiên sau dòng cuối cùng có Tên
function nextEmptyRow_(sheet, L) {
  const rows = noNames_(sheet, L);
  let lastName = FIRST_ROW - 1;
  for (let i = 0; i < rows.length; i++) if (String(rows[i][1]).trim()) lastName = FIRST_ROW + i;
  return lastName + 1;
}

function maxNo_(sheet, L) {
  let max = 0;
  noNames_(sheet, L).forEach(function (r) { if (String(r[1]).trim() && Number(r[0]) > max) max = Number(r[0]); });
  return max;
}

function saveItem_(item) {
  if (!String(item.name || '').trim()) throw new Error('Thiếu tên Zippo.');
  const sheet = ss_().getSheetByName(SHEET_INPUT);
  const L = layout_(sheet);
  const COL = L.col;
  let row = item.no ? findRow_(sheet, L, item.no) : 0;
  const isNew = !row;
  if (isNew) {
    row = nextEmptyRow_(sheet, L);
    if (!item.no) item.no = maxNo_(sheet, L) + 1;
    ensureFormulas_(sheet, L, row);
    if (COL.qlt) sheet.getRange(row, COL.qlt).setValue(1);
  }
  const fields = {
    no: Number(item.no), name: item.name, sku: item.sku, caseType: item.caseType, finish: item.finish,
    left: item.left, right: codeRight_(item.right), price: item.price === '' || item.price == null ? '' : Number(item.price),
    date: item.date ? parseDate_(item.date) : '', caseCond: item.caseCond, insertsCond: item.insertsCond,
    buyFrom: item.buyFrom, origin: item.origin, note: item.note, collection: item.collection,
  };
  Object.keys(fields).forEach(function (k) {
    if (!COL[k]) return; // sheet không có cột này
    if (!isNew && !(k in item) && k !== 'no') return; // không gửi = không đổi
    const cell = sheet.getRange(row, COL[k]);
    let v = fields[k];
    if (v === undefined || v === null) v = '';
    // Chỉ ghi khi giá trị thực sự đổi, để giữ nguyên các công thức anh đã gõ (VD: cột giá)
    if (!isNew && sameValue_(cell.getValue(), v)) return;
    cell.setValue(v);
  });
  if (item.photosCount && COL.pic) sheet.getRange(row, COL.pic).setValue('x');
  ensureDataRow_(row);
  SpreadsheetApp.flush();
  return readItems_(true).filter(function (it) { return it.no === Number(item.no); })[0] || { no: Number(item.no) };
}

function codeRight_(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d+$/.test(s) ? Number(s) : s;
}

function parseDate_(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : s;
}

function sameValue_(a, b) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return String(a) === String(b);
}

// Chép mọi cột công thức của dòng 3 (Code date/month/year, năm mua, Code, giá × 1000…) xuống dòng mới
function ensureFormulas_(sheet, L, row) {
  L.formulaCols.forEach(function (c) {
    sheet.getRange(FIRST_ROW, c).copyTo(sheet.getRange(row, c), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
  });
}

// "Data Zippo" có sẵn công thức tới dòng 499; nếu bộ sưu tập dài hơn thì kéo thêm
function ensureDataRow_(inputRow) {
  const data = ss_().getSheetByName(SHEET_DATA);
  const dataRow = inputRow - 1;
  const last = data.getLastRow();
  if (dataRow <= last) return;
  const width = data.getLastColumn();
  data.getRange(last, 1, 1, width)
    .copyTo(data.getRange(last + 1, 1, dataRow - last, width), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
}

// Xoá: kéo các dòng bên dưới lên một dòng (để sheet không bị dòng trống ở giữa và Data Zippo vẫn đúng)
function deleteItem_(no) {
  const sheet = ss_().getSheetByName(SHEET_INPUT);
  const L = layout_(sheet);
  const row = findRow_(sheet, L, no);
  if (!row) throw new Error('Không tìm thấy No. ' + no);
  const lastName = nextEmptyRow_(sheet, L) - 1;
  // Chỉ dời các cột anh nhập tay; cột công thức giữ nguyên
  L.inputCols.forEach(function (c) {
    if (lastName > row) {
      sheet.getRange(row + 1, c, lastName - row, 1)
        .copyTo(sheet.getRange(row, c, lastName - row, 1), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
    }
    sheet.getRange(lastName, c).clearContent();
  });
  SpreadsheetApp.flush();
  return Number(no);
}

// ---------- Ảnh ----------

function folder_() { return DriveApp.getFolderById(PHOTO_FOLDER_ID); }

// Quy ước đặt tên ảnh: 12.jpg là ảnh chính, 12_2.jpg, 12_3.jpg… là ảnh phụ.
// (Vẫn nhận thêm "12 (1).jpg", "12-2.jpg" cho chắc. Trang web cũng đọc tên ảnh theo quy tắc này.)
const PHOTO_NAME = /^(\d+)\s*(?:[_\-\s]\s*(\d+)|\(\s*(\d+)\s*\))?\s*\.(jpe?g|png|webp|heic|gif)$/i;

// Danh sách mọi file ảnh trong thư mục: [{n: tên, id}]
function photoFiles_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('files');
  if (hit) return JSON.parse(hit);
  const files = [];
  const it = folder_().getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    files.push({ n: f.getName().trim(), id: f.getId() });
  }
  const json = JSON.stringify(files);
  if (json.length < 90000) cache.put('files', json, 120);
  return files;
}

// { no: [{id, name, idx}] }
function photoMap_() {
  const map = {};
  photoFiles_().forEach(function (f) {
    const m = f.n.match(PHOTO_NAME);
    if (!m) return;
    const no = Number(m[1]);
    const idx = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : 0;
    (map[no] = map[no] || []).push({ id: f.id, name: f.n, idx: idx });
  });
  Object.keys(map).forEach(function (k) { map[k].sort(function (a, b) { return a.idx - b.idx; }); });
  return map;
}

function clearPhotoCache_() { CacheService.getScriptCache().removeAll(['files', 'photos']); }

function uploadPhoto_(no, base64, mime) {
  if (!no || !base64) throw new Error('Thiếu ảnh.');
  clearPhotoCache_();
  const list = photoMap_()[Number(no)] || [];
  // Ảnh đầu tiên: 12.jpg, các ảnh sau: 12_2.jpg, 12_3.jpg…
  const nextIdx = list.length ? Math.max(1, list.reduce(function (m, f) { return Math.max(m, f.idx); }, 0)) + 1 : 1;
  const name = nextIdx === 1 ? no + '.jpg' : no + '_' + nextIdx + '.jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime || 'image/jpeg', name);
  const file = folder_().createFile(blob);
  markPic_(no, true);
  clearPhotoCache_();
  return { id: file.getId(), name: name };
}

// Đánh dấu cột "Pic" trong sheet Zippo
function markPic_(no, on) {
  const sheet = ss_().getSheetByName(SHEET_INPUT);
  const L = layout_(sheet);
  const row = findRow_(sheet, L, no);
  if (!row || !L.col.pic) return;
  const cell = sheet.getRange(row, L.col.pic);
  if (on) cell.setValue('x'); else cell.clearContent();
}

function deletePhoto_(no, id) {
  DriveApp.getFileById(id).setTrashed(true);
  clearPhotoCache_();
  const left = photoMap_()[Number(no)] || [];
  if (!left.length) {
    markPic_(no, false);
  }
  return left.map(function (f) { return f.id; });
}

// Đổi tên để ảnh được chọn thành 12.jpg (ảnh chính)
function setMainPhoto_(no, id) {
  clearPhotoCache_();
  const list = photoMap_()[Number(no)] || [];
  const target = list.filter(function (f) { return f.id === id; })[0];
  const main = list[0];
  if (target && main && target.id !== main.id) {
    const tmp = DriveApp.getFileById(main.id);
    tmp.setName('tmp_' + main.name);
    DriveApp.getFileById(target.id).setName(main.name);
    tmp.setName(target.name);
  }
  clearPhotoCache_();
  return (photoMap_()[Number(no)] || []).map(function (f) { return f.id; });
}

// ---------- Chạy một lần khi cài đặt ----------

/** Bấm Run hàm này một lần: tạo sheet "Danh mục" và cho phép xem ảnh qua link. */
function setup() {
  if (!ownerPassword_()) throw new Error('Anh gõ mật khẩu vào dòng OWNER_PASSWORD rồi chạy lại setup nhé.');
  listsSheet_();
  folder_().setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  clearPhotoCache_();
  Logger.log('Xong. Đã lưu mật khẩu. Số Zippo đọc được: ' + readItems_(true).length +
    ', số ảnh: ' + Object.keys(photoMap_()).length + ' chiếc có ảnh.');
}
