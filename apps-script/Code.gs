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

// Cột trong sheet "Zippo" (1 = A). Các cột công thức H, I, J, N, W, X không bao giờ bị ghi đè.
const COL = { no: 1, name: 2, sku: 3, caseType: 4, finish: 5, left: 6, right: 7, qlt: 11, price: 12, date: 13,
  caseCond: 15, insertsCond: 16, buyFrom: 17, origin: 18, note: 19, pic: 22 };
const FORMULA_RANGES = ['H{r}:J{r}', 'N{r}', 'W{r}:X{r}'];
const INPUT_BLOCKS = [[1, 7], [11, 13], [15, 22]]; // A:G, K:M, O:V

// Cột trong sheet "Data Zippo" (0 = A)
const D = { no: 0, name: 1, sku: 2, caseType: 3, finish: 4, code: 5, codeYear: 6, price: 7, date: 8, yearPurchase: 9,
  caseCond: 10, insertsCond: 11, buyFrom: 12, origin: 13, note: 14, tag: 15 };
const PRIVATE_FIELDS = ['price', 'date', 'yearPurchase', 'caseCond', 'insertsCond', 'buyFrom', 'origin', 'note'];

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
  const input = ss.getSheetByName(SHEET_INPUT);
  const codes = input.getRange(FIRST_ROW, COL.left, Math.max(data.length - 1, 1), 2).getDisplayValues();
  const photos = photoMap_();
  const tz = ss.getSpreadsheetTimeZone();
  const items = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const name = clean_(r[D.name]);
    const no = Number(r[D.no]);
    if (!name || !no) continue;
    const item = {
      no: no,
      name: name,
      sku: clean_(r[D.sku]),
      caseType: clean_(r[D.caseType]),
      finish: clean_(r[D.finish]),
      code: clean_(r[D.code]) === '-' ? '' : clean_(r[D.code]),
      codeYear: num_(r[D.codeYear]),
      tag: clean_(r[D.tag]),
      photos: (photos[no] || []).map(function (f) { return f.id; }),
    };
    if (owner) {
      item.left = codes[i - 1] ? codes[i - 1][0] : '';
      item.right = codes[i - 1] ? codes[i - 1][1] : '';
      item.price = num_(r[D.price]);
      // Ô ngày trống trong sheet hiện ra là năm 1899/1900 — coi như chưa có
      const d = r[D.date] instanceof Date && r[D.date].getFullYear() > 1950 ? r[D.date] : null;
      item.date = d ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '';
      const y = num_(r[D.yearPurchase]);
      item.yearPurchase = item.date ? Number(item.date.slice(0, 4)) : (y && y > 1950 ? y : null);
      item.caseCond = clean_(r[D.caseCond]);
      item.insertsCond = clean_(r[D.insertsCond]);
      item.buyFrom = clean_(r[D.buyFrom]);
      item.origin = clean_(r[D.origin]);
      item.note = clean_(r[D.note]);
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

function findRow_(sheet, no) {
  const last = sheet.getLastRow();
  const nos = sheet.getRange(FIRST_ROW, COL.no, last - FIRST_ROW + 1, 2).getValues();
  for (let i = 0; i < nos.length; i++) {
    if (Number(nos[i][0]) === Number(no) && String(nos[i][1]).trim()) return FIRST_ROW + i;
  }
  return 0;
}

// Dòng trống đầu tiên sau dòng cuối cùng có Tên
function nextEmptyRow_(sheet) {
  const last = sheet.getLastRow();
  const names = sheet.getRange(FIRST_ROW, COL.name, Math.max(last - FIRST_ROW + 1, 1), 1).getValues();
  let lastName = FIRST_ROW - 1;
  for (let i = 0; i < names.length; i++) if (String(names[i][0]).trim()) lastName = FIRST_ROW + i;
  return lastName + 1;
}

function maxNo_(sheet) {
  const last = sheet.getLastRow();
  const vals = sheet.getRange(FIRST_ROW, COL.no, last - FIRST_ROW + 1, 2).getValues();
  let max = 0;
  vals.forEach(function (r) { if (String(r[1]).trim() && Number(r[0]) > max) max = Number(r[0]); });
  return max;
}

function saveItem_(item) {
  if (!String(item.name || '').trim()) throw new Error('Thiếu tên Zippo.');
  const sheet = ss_().getSheetByName(SHEET_INPUT);
  let row = item.no ? findRow_(sheet, item.no) : 0;
  const isNew = !row;
  if (isNew) {
    row = nextEmptyRow_(sheet);
    if (!item.no) item.no = maxNo_(sheet) + 1;
    ensureFormulas_(sheet, row);
    sheet.getRange(row, COL.qlt).setValue(1);
  }
  const fields = {
    no: Number(item.no), name: item.name, sku: item.sku, caseType: item.caseType, finish: item.finish,
    left: item.left, right: codeRight_(item.right), price: item.price === '' || item.price == null ? '' : Number(item.price),
    date: item.date ? parseDate_(item.date) : '', caseCond: item.caseCond, insertsCond: item.insertsCond,
    buyFrom: item.buyFrom, origin: item.origin, note: item.note,
  };
  Object.keys(fields).forEach(function (k) {
    if (!isNew && !(k in item) && k !== 'no') return; // không gửi = không đổi
    const cell = sheet.getRange(row, COL[k]);
    let v = fields[k];
    if (v === undefined || v === null) v = '';
    // Chỉ ghi khi giá trị thực sự đổi, để giữ nguyên các công thức anh đã gõ (VD: cột giá)
    if (!isNew && sameValue_(cell.getValue(), v)) return;
    cell.setValue(v);
  });
  if (item.photosCount) sheet.getRange(row, COL.pic).setValue('x');
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

// Chép công thức (Code date/month/year, năm mua, Code, giá × 1000) từ dòng 3 xuống dòng mới
function ensureFormulas_(sheet, row) {
  FORMULA_RANGES.forEach(function (tpl) {
    const target = sheet.getRange(tpl.replace(/\{r\}/g, row));
    const source = sheet.getRange(tpl.replace(/\{r\}/g, FIRST_ROW));
    source.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
  });
}

// "Data Zippo" có sẵn công thức tới dòng 499; nếu bộ sưu tập dài hơn thì kéo thêm
function ensureDataRow_(inputRow) {
  const data = ss_().getSheetByName(SHEET_DATA);
  const dataRow = inputRow - 1;
  const last = data.getLastRow();
  if (dataRow <= last) return;
  const src = data.getRange(last, 1, 1, 15);
  src.copyTo(data.getRange(last + 1, 1, dataRow - last, 15), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
}

// Xoá: kéo các dòng bên dưới lên một dòng (để sheet không bị dòng trống ở giữa và Data Zippo vẫn đúng)
function deleteItem_(no) {
  const sheet = ss_().getSheetByName(SHEET_INPUT);
  const row = findRow_(sheet, no);
  if (!row) throw new Error('Không tìm thấy No. ' + no);
  const lastName = nextEmptyRow_(sheet) - 1;
  INPUT_BLOCKS.forEach(function (b) {
    const width = b[1] - b[0] + 1;
    if (lastName > row) {
      sheet.getRange(row + 1, b[0], lastName - row, width)
        .copyTo(sheet.getRange(row, b[0], lastName - row, width), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
    }
    sheet.getRange(lastName, b[0], 1, width).clearContent();
  });
  SpreadsheetApp.flush();
  return Number(no);
}

// ---------- Ảnh ----------

function folder_() { return DriveApp.getFolderById(PHOTO_FOLDER_ID); }

// Tên ảnh hợp lệ: bắt đầu bằng số No., VD "12.jpg", "12 (1).jpg", "12(2).jpg", "12_3.jpg", "12-4.jpg".
// Ảnh có số phụ nhỏ nhất là ảnh chính. (Trang web cũng tự đọc tên ảnh theo đúng quy tắc này.)
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
  // Đặt tên giống kiểu Windows: 12 (1).jpg, 12 (2).jpg…
  const nextIdx = list.reduce(function (m, f) { return Math.max(m, f.idx); }, 0) + 1;
  const name = no + ' (' + nextIdx + ').jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime || 'image/jpeg', name);
  const file = folder_().createFile(blob);
  const sheet = ss_().getSheetByName(SHEET_INPUT);
  const row = findRow_(sheet, no);
  if (row) sheet.getRange(row, COL.pic).setValue('x');
  clearPhotoCache_();
  return { id: file.getId(), name: name };
}

function deletePhoto_(no, id) {
  DriveApp.getFileById(id).setTrashed(true);
  clearPhotoCache_();
  const left = photoMap_()[Number(no)] || [];
  if (!left.length) {
    const sheet = ss_().getSheetByName(SHEET_INPUT);
    const row = findRow_(sheet, no);
    if (row) sheet.getRange(row, COL.pic).clearContent();
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
