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

// Số phiên bản: trang web so với số này để báo khi Apps Script chưa được cập nhật
const API_VERSION = 5;

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
  ['no', 1, 'No.'], ['id', 1, 'ID'], ['name', 1, 'Name'], ['sku', 1, 'SKU'], ['caseType', 1, 'Case'], ['finish', 1, 'Finish'],
  ['left', 2, 'Left'], ['right', 2, 'Right'], ['qlt', 2, 'QLT'], ['price', 2, 'Price'], ['date', 2, 'Date'],
  ['caseCond', 2, 'Case'], ['insertsCond', 2, 'Inserts'], ['buyFrom', 1, 'Buy From'], ['origin', 1, 'Country of origin'],
  ['note', 1, 'Note'], ['collection', 1, 'Collection'], ['tag', 1, 'Tag'], ['pic', 2, 'Pic'],
];
const DATA_HEADERS = {
  no: 'No.', id: 'ID', name: 'Name', sku: 'SKU', caseType: 'Case', finish: 'Finish', code: 'Code', codeYear: 'Code Year',
  price: 'Price', date: 'Date Purchse|Date Purchase', yearPurchase: 'Year Purchse|Year Purchase', caseCond: 'Case cond.',
  insertsCond: 'Inserts Cond.', buyFrom: 'Buy From', origin: 'Country of origin', note: 'Note', collection: 'Collection', tag: 'Tag',
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
    if (p.action === 'ping') return { ok: true, version: API_VERSION };
    // Khách xem qua GET; chủ đọc qua POST (action "list") để mật khẩu không nằm trên đường link
    return { ok: true, version: API_VERSION, owner: false, items: readItems_(false), lists: readLists_(), files: photoFiles_(), updated: new Date().toISOString() };
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
        case 'list': return { ok: true, version: API_VERSION, owner: true, items: readItems_(true), lists: readLists_(), files: photoFiles_(), updated: new Date().toISOString() };
        case 'save': return { ok: true, item: saveItem_(body.item || {}) };
        // "pid" = ID cố định của chiếc Zippo (bản web cũ chỉ gửi "no")
        case 'delete': return { ok: true, pid: deleteItem_(pid_(body)) };
        case 'uploadPhoto': return { ok: true, photo: uploadPhoto_(pid_(body), body.data, body.mime) };
        case 'deletePhoto': return { ok: true, photos: deletePhoto_(pid_(body), body.id) };
        case 'setMainPhoto': return { ok: true, photos: setMainPhoto_(pid_(body), body.id) };
        case 'syncFolders': return { ok: true, result: dongBoThuMucAnh() };
        default: throw new Error('Không rõ thao tác: ' + body.action);
      }
    } finally {
      lock.releaseLock();
    }
  });
}

function pid_(body) { return Number(body.pid != null ? body.pid : body.no); }

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
  const input = ss.getSheetByName(SHEET_INPUT);
  const L = layout_(input).col;
  const n = Math.max(data.length - 1, 1);
  const zcol = function (c) { return c ? input.getRange(FIRST_ROW, c, n, 1).getDisplayValues() : []; };
  // Tag: lấy ở Data Zippo nếu có cột "Tag", không thì lấy thẳng từ sheet Zippo
  const tags = D.tag == null ? zcol(L.tag) : null;
  // ID cố định (tên ảnh): lấy ở Data Zippo nếu có cột "ID", không thì ở sheet Zippo; chưa có cột ID thì dùng No.
  const ids = D.id == null && L.id ? input.getRange(FIRST_ROW, L.id, n, 1).getValues() : null;
  let codes = [];
  if (owner) {
    const left = zcol(L.left);
    const right = zcol(L.right);
    codes = left.map(function (r, i) { return [r[0], right[i][0]]; });
  }
  const photos = photoMap_();
  const tz = ss.getSpreadsheetTimeZone();
  const items = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const name = clean_(v(r, 'name'));
    const no = Number(v(r, 'no'));
    const id = Number(D.id != null ? v(r, 'id') : ids ? (ids[i - 1] || [''])[0] : no) || no;
    if (!name || !id) continue;
    const item = {
      id: id,
      no: no || null,
      name: name,
      sku: clean_(v(r, 'sku')),
      caseType: clean_(v(r, 'caseType')),
      finish: clean_(v(r, 'finish')),
      code: clean_(v(r, 'code')) === '-' ? '' : clean_(v(r, 'code')),
      codeYear: num_(v(r, 'codeYear')),
      collection: clean_(v(r, 'collection')),
      tag: clean_(tags ? (tags[i - 1] || [''])[0] : v(r, 'tag')),
      photos: (photos[id] || []).map(function (f) { return f.id; }),
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

// Cột dùng để tìm một chiếc Zippo: cột ID nếu đã có, chưa có thì cột No.
function keyCol_(L) { return L.col.id || L.col.no; }

// [[ID (hoặc No.), Tên], …] từ dòng 3 trở xuống. Truyền col để đọc cột khác thay cho ID.
function noNames_(sheet, L, col) {
  const n = Math.max(sheet.getLastRow() - FIRST_ROW + 1, 1);
  const nos = sheet.getRange(FIRST_ROW, col || keyCol_(L), n, 1).getValues();
  const names = sheet.getRange(FIRST_ROW, L.col.name, n, 1).getValues();
  return nos.map(function (r, i) { return [r[0], names[i][0]]; });
}

function findRow_(sheet, L, pid) {
  const rows = noNames_(sheet, L);
  for (let i = 0; i < rows.length; i++) {
    if (Number(rows[i][0]) === Number(pid) && String(rows[i][1]).trim()) return FIRST_ROW + i;
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

function maxNo_(sheet, L, col) {
  let max = 0;
  noNames_(sheet, L, col).forEach(function (r) { if (String(r[1]).trim() && Number(r[0]) > max) max = Number(r[0]); });
  return max;
}

function saveItem_(item) {
  if (!String(item.name || '').trim()) throw new Error('Thiếu tên Zippo.');
  const sheet = ss_().getSheetByName(SHEET_INPUT);
  const L = layout_(sheet);
  const COL = L.col;
  // Tìm theo ID cố định (chưa có cột ID thì theo No.)
  const pid = COL.id ? item.id : (item.id || item.no); // chưa có cột ID: item.id là No. cũ
  let row = pid ? findRow_(sheet, L, pid) : 0;
  const isNew = !row;
  if (isNew) {
    row = nextEmptyRow_(sheet, L);
    if (!item.no) item.no = maxNo_(sheet, L, COL.no) + 1;
    if (COL.id && !item.id) item.id = maxNo_(sheet, L, COL.id) + 1;
    ensureFormulas_(sheet, L, row);
    if (COL.qlt) sheet.getRange(row, COL.qlt).setValue(1);
  }
  if (!COL.id) item.id = item.no || pid;
  const fields = {
    no: item.no === '' || item.no == null ? '' : Number(item.no), id: Number(item.id), name: item.name, sku: item.sku, caseType: item.caseType, finish: item.finish,
    left: item.left, right: codeRight_(item.right), price: item.price === '' || item.price == null ? '' : Number(item.price),
    date: item.date ? parseDate_(item.date) : '', caseCond: item.caseCond, insertsCond: item.insertsCond,
    buyFrom: item.buyFrom, origin: item.origin, note: item.note, collection: item.collection, tag: item.tag,
  };
  Object.keys(fields).forEach(function (k) {
    if (!COL[k]) return; // sheet không có cột này
    if (!isNew && !(k in item)) return; // không gửi = không đổi
    if (!isNew && k === 'id') return; // ID không bao giờ đổi
    const cell = sheet.getRange(row, COL[k]);
    let v = fields[k];
    if (v === undefined || v === null) v = '';
    // Chỉ ghi khi giá trị thực sự đổi, để giữ nguyên các công thức anh đã gõ (VD: cột giá)
    if (!isNew && sameValue_(cell.getValue(), v)) return;
    cell.setValue(v);
  });
  if (item.photosCount && COL.pic) sheet.getRange(row, COL.pic).setValue('x');
  ensureDataRow_(row);
  if (isNew || 'name' in item) syncOneFolder_(Number(item.id), item.name);
  SpreadsheetApp.flush();
  return readItems_(true).filter(function (it) { return it.id === Number(item.id); })[0] || { id: Number(item.id), no: Number(item.no) };
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
function deleteItem_(pid) {
  const sheet = ss_().getSheetByName(SHEET_INPUT);
  const L = layout_(sheet);
  const row = findRow_(sheet, L, pid);
  if (!row) throw new Error('Không tìm thấy Zippo có ID ' + pid);
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
  return Number(pid);
}

// ---------- Ảnh ----------
//
// Mỗi Zippo một thư mục con trong "Anh Zippo", tên thư mục: "ID - Tên", ví dụ "125 - Armor Dragon".
// Web chỉ nhìn SỐ ID ở đầu tên thư mục; phần tên phía sau để anh dễ tìm, sai lệch cũng không sao
// (hàm dongBoThuMucAnh tự sửa lại cho khớp tên trong sheet).
// Ảnh trong thư mục đặt tên tuỳ ý; ảnh đứng đầu theo thứ tự tên là ảnh chính (web đặt 1.jpg, 2.jpg…).
// Ảnh rời kiểu cũ ngay trong "Anh Zippo" (12.jpg, 12_2.jpg) vẫn được nhận, và được gom vào thư mục khi đồng bộ.

function folder_() { return DriveApp.getFolderById(PHOTO_FOLDER_ID); }

const PHOTO_NAME = /^(\d+)\s*(?:[_\-\s]\s*(\d+)|\(\s*(\d+)\s*\))?\s*\.(jpe?g|png|webp|heic|gif)$/i;
const FOLDER_ID_RE = /^\s*(\d+)(?!\d)/;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const IMAGE_RE = /\.(jpe?g|png|webp|heic|gif)$/i;
const naturalCmp_ = function (a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }); };

// Gọi Drive API để liệt kê nhanh (nhanh hơn duyệt từng thư mục bằng DriveApp rất nhiều)
function driveList_(q, fields) {
  const out = [];
  let token = '';
  do {
    const url = 'https://www.googleapis.com/drive/v3/files?pageSize=1000&q=' + encodeURIComponent(q) +
      '&fields=' + encodeURIComponent('nextPageToken,files(' + fields + ')') + (token ? '&pageToken=' + token : '');
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('Drive: ' + res.getContentText().slice(0, 200));
    const body = JSON.parse(res.getContentText());
    Array.prototype.push.apply(out, body.files || []);
    token = body.nextPageToken || '';
  } while (token);
  return out;
}

// Bộ nhớ đệm cho danh sách ảnh (chia nhỏ vì mỗi ô nhớ chỉ chứa ~100KB)
function cacheGetBig_(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + '_n') || 0);
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + '_' + i);
  const parts = cache.getAll(keys);
  let json = '';
  for (let i = 0; i < n; i++) { if (parts[key + '_' + i] == null) return null; json += parts[key + '_' + i]; }
  return JSON.parse(json);
}
function cachePutBig_(key, value, ttl) {
  const json = JSON.stringify(value);
  const obj = {};
  let n = 0;
  for (let i = 0; i < json.length; i += 90000) obj[key + '_' + n++] = json.slice(i, i + 90000);
  obj[key + '_n'] = String(n);
  if (n <= 50) CacheService.getScriptCache().putAll(obj, ttl);
}

/**
 * Toàn bộ ảnh: { folders: [{id, name, k}], loose: [{id, n, k, idx}], files: [{id, n, k}] }
 * k = ID của chiếc Zippo. "files" là danh sách gửi cho trang web.
 */
function photoIndex_() {
  const hit = cacheGetBig_('pidx');
  if (hit) return hit;
  const root = PHOTO_FOLDER_ID;
  const children = driveList_("'" + root + "' in parents and trashed=false", 'id,name,mimeType');
  const folders = [];
  const loose = [];
  children.forEach(function (f) {
    if (f.mimeType === FOLDER_MIME) {
      const m = f.name.match(FOLDER_ID_RE);
      if (m) folders.push({ id: f.id, name: f.name, k: Number(m[1]) });
      return;
    }
    const m = f.name.trim().match(PHOTO_NAME);
    if (m) loose.push({ id: f.id, n: f.name.trim(), k: Number(m[1]), idx: m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : 0 });
  });
  const kOf = {};
  folders.forEach(function (f) { kOf[f.id] = f.k; });
  const inFolders = [];
  for (let i = 0; i < folders.length; i += 40) {
    const q = '(' + folders.slice(i, i + 40).map(function (f) { return "'" + f.id + "' in parents"; }).join(' or ') + ') and trashed=false';
    driveList_(q, 'id,name,parents,mimeType').forEach(function (f) {
      if (f.mimeType === FOLDER_MIME || !IMAGE_RE.test(f.name)) return;
      const parent = (f.parents || []).filter(function (p) { return kOf[p] != null; })[0];
      if (parent) inFolders.push({ id: f.id, n: f.name.trim(), k: kOf[parent], f: parent });
    });
  }
  const files = loose.map(function (f) { return { id: f.id, n: f.n }; })
    .concat(inFolders.map(function (f) { return { id: f.id, n: f.n, k: f.k }; }));
  const idx = { folders: folders, loose: loose, inFolders: inFolders, files: files };
  cachePutBig_('pidx', idx, 300);
  return idx;
}

// Danh sách gửi cho trang web: [{n: tên ảnh, id, k: ID chiếc Zippo nếu ảnh nằm trong thư mục}]
function photoFiles_() { return photoIndex_().files; }

// { ID: [{id, name}] } — ảnh rời kiểu cũ trước, rồi ảnh trong thư mục theo thứ tự tên
function photoMap_() {
  const idx = photoIndex_();
  const map = {};
  idx.loose.slice().sort(function (a, b) { return a.idx - b.idx; }).forEach(function (f) {
    (map[f.k] = map[f.k] || []).push({ id: f.id, name: f.n, folder: null });
  });
  const groups = {};
  idx.inFolders.forEach(function (f) { (groups[f.k] = groups[f.k] || []).push(f); });
  Object.keys(groups).forEach(function (k) {
    groups[k].sort(function (a, b) { return naturalCmp_(a.n, b.n); }).forEach(function (f) {
      (map[k] = map[k] || []).push({ id: f.id, name: f.n, folder: f.f });
    });
  });
  return map;
}

function clearPhotoCache_() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('pidx_n') || 0);
  const keys = ['pidx_n', 'files', 'photos'];
  for (let i = 0; i < n; i++) keys.push('pidx_' + i);
  cache.removeAll(keys);
}

// Tên thư mục chuẩn: "ID - Tên" (bỏ các ký tự Drive/Windows không thích)
function folderName_(pid, name) {
  const clean = String(name || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return clean ? pid + ' - ' + clean : String(pid);
}

// { ID: Tên } đọc từ sheet Zippo
function itemNames_() {
  const sheet = ss_().getSheetByName(SHEET_INPUT);
  const L = layout_(sheet);
  const out = {};
  noNames_(sheet, L).forEach(function (r) {
    const k = Number(r[0]);
    const name = String(r[1]).trim();
    if (k > 0 && name && out[k] == null) out[k] = name;
  });
  return out;
}

// Thư mục ảnh của một chiếc: có rồi thì dùng (và gom ảnh rời kiểu cũ vào), chưa có thì tạo
function photoFolderFor_(pid, name) {
  const idx = photoIndex_();
  const found = idx.folders.filter(function (f) { return f.k === Number(pid); })[0];
  let folder;
  if (found) {
    folder = DriveApp.getFolderById(found.id);
  } else {
    if (name == null) name = itemNames_()[Number(pid)] || '';
    folder = folder_().createFolder(folderName_(pid, name));
  }
  const loose = idx.loose.filter(function (f) { return f.k === Number(pid); });
  if (loose.length) moveLoose_(loose, folder);
  if (!found || loose.length) clearPhotoCache_();
  return folder;
}

// 12.jpg → 1.jpg, 12_2.jpg → 2.jpg… rồi chuyển vào thư mục của chiếc đó
function moveLoose_(loose, folder) {
  const taken = {};
  const it = folder.getFiles();
  while (it.hasNext()) taken[it.next().getName().toLowerCase()] = true;
  loose.slice().sort(function (a, b) { return a.idx - b.idx; }).forEach(function (f) {
    const ext = (f.n.match(/\.[^.]+$/) || ['.jpg'])[0].toLowerCase();
    let n = Math.max(1, f.idx);
    while (taken[(n + ext)]) n++;
    taken[n + ext] = true;
    const file = DriveApp.getFileById(f.id);
    file.setName(n + ext);
    file.moveTo(folder);
  });
}

function uploadPhoto_(pid, base64, mime) {
  if (!pid || !base64) throw new Error('Thiếu ảnh.');
  clearPhotoCache_();
  const folder = photoFolderFor_(pid);
  // Đặt tên 1.jpg, 2.jpg… nối tiếp số lớn nhất đang có trong thư mục
  let max = 0;
  const it = folder.getFiles();
  while (it.hasNext()) { const m = it.next().getName().match(/^(\d+)/); if (m) max = Math.max(max, Number(m[1])); }
  const name = (max + 1) + '.jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mime || 'image/jpeg', name);
  const file = folder.createFile(blob);
  markPic_(pid, true);
  clearPhotoCache_();
  return { id: file.getId(), name: name };
}

// Đánh dấu cột "Pic" trong sheet Zippo
function markPic_(pid, on) {
  const sheet = ss_().getSheetByName(SHEET_INPUT);
  const L = layout_(sheet);
  const row = findRow_(sheet, L, pid);
  if (!row || !L.col.pic) return;
  const cell = sheet.getRange(row, L.col.pic);
  if (on) cell.setValue('x'); else cell.clearContent();
}

function deletePhoto_(pid, id) {
  DriveApp.getFileById(id).setTrashed(true);
  clearPhotoCache_();
  const left = photoMap_()[Number(pid)] || [];
  if (!left.length) markPic_(pid, false);
  return left.map(function (f) { return f.id; });
}

// Đổi tên để ảnh được chọn đứng đầu thư mục (ảnh chính)
function setMainPhoto_(pid, id) {
  clearPhotoCache_();
  photoFolderFor_(pid); // gom ảnh rời kiểu cũ vào thư mục trước, để mọi ảnh cùng một chỗ
  const list = photoMap_()[Number(pid)] || [];
  const target = list.filter(function (f) { return f.id === id; })[0];
  const main = list[0];
  if (target && main && target.id !== main.id) {
    const tmp = DriveApp.getFileById(main.id);
    tmp.setName('tmp_' + main.name);
    DriveApp.getFileById(target.id).setName(main.name);
    tmp.setName(target.name);
  }
  clearPhotoCache_();
  return (photoMap_()[Number(pid)] || []).map(function (f) { return f.id; });
}

// Sau khi lưu một chiếc: đổi tên thư mục nếu tên Zippo đã đổi (chưa có thư mục thì tạo)
function syncOneFolder_(pid, name) {
  try {
    const found = photoIndex_().folders.filter(function (f) { return f.k === Number(pid); })[0];
    const want = folderName_(pid, name);
    if (!found) { folder_().createFolder(want); clearPhotoCache_(); return; }
    if (found.name !== want) { DriveApp.getFolderById(found.id).setName(want); clearPhotoCache_(); }
  } catch (e) { /* lỗi thư mục ảnh không được làm hỏng việc lưu */ }
}

/**
 * ĐỒNG BỘ THƯ MỤC ẢNH — chạy tự động mỗi đêm, hoặc anh bấm Run / bấm nút trên web.
 * - Mỗi Zippo trong sheet có một thư mục "ID - Tên" (chưa có thì tạo).
 * - Tên thư mục lệch với tên trong sheet thì đổi lại cho khớp.
 * - Ảnh rời kiểu cũ (12.jpg, 12_2.jpg) được chuyển vào thư mục, đổi tên thành 1.jpg, 2.jpg.
 * Không bao giờ xoá ảnh hay thư mục. Chạy dở vì hết giờ thì lần sau chạy tiếp.
 */
function dongBoThuMucAnh() {
  const start = Date.now();
  const names = itemNames_();
  clearPhotoCache_();
  const idx = photoIndex_();
  const byK = {};
  idx.folders.forEach(function (f) { if (!byK[f.k]) byK[f.k] = f; });
  const looseByK = {};
  idx.loose.forEach(function (f) { (looseByK[f.k] = looseByK[f.k] || []).push(f); });
  const done = { created: 0, renamed: 0, moved: 0, left: 0 };
  Object.keys(names).forEach(function (k) {
    if (Date.now() - start > 4.5 * 60 * 1000) { done.left++; return; }
    const want = folderName_(k, names[k]);
    const f = byK[k];
    let folder;
    if (!f) { folder = folder_().createFolder(want); done.created++; }
    else if (f.name !== want) { folder = DriveApp.getFolderById(f.id); folder.setName(want); done.renamed++; }
    if (looseByK[k]) {
      moveLoose_(looseByK[k], folder || DriveApp.getFolderById(f.id));
      done.moved += looseByK[k].length;
    }
  });
  clearPhotoCache_();
  const msg = 'Thư mục ảnh: tạo mới ' + done.created + ', đổi tên ' + done.renamed + ', gom ' + done.moved + ' ảnh rời vào thư mục' +
    (done.left ? '. Còn ' + done.left + ' chiếc chưa làm kịp, anh chạy lại lần nữa nhé.' : '. Xong.');
  Logger.log(msg);
  return Object.assign(done, { message: msg });
}

// Hẹn giờ chạy dongBoThuMucAnh mỗi đêm (khoảng 2–3 giờ sáng)
function ensureNightlyTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dongBoThuMucAnh'; });
  if (!has) ScriptApp.newTrigger('dongBoThuMucAnh').timeBased().everyDays(1).atHour(2).create();
}

// ---------- Chạy một lần khi cài đặt ----------

/** Bấm Run hàm này một lần: tạo sheet "Danh mục" và cho phép xem ảnh qua link. */
function setup() {
  if (!ownerPassword_()) throw new Error('Anh gõ mật khẩu vào dòng OWNER_PASSWORD rồi chạy lại setup nhé.');
  listsSheet_();
  ensureIdColumn_();
  folder_().setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  ensureNightlyTrigger_();
  dongBoThuMucAnh();
  Logger.log('Xong. Đã lưu mật khẩu. Số Zippo đọc được: ' + readItems_(true).length +
    ', số ảnh: ' + Object.keys(photoMap_()).length + ' chiếc có ảnh.');
}

/**
 * Tạo cột "ID" ngay sau cột No. trong sheet Zippo (chỉ làm một lần, có rồi thì bỏ qua).
 * ID ban đầu = số No. hiện tại, nên ảnh cũ (12.jpg, 12_2.jpg…) vẫn khớp, không phải đổi tên ảnh.
 * No. trùng nhau hoặc để trống thì được cấp ID mới (số lớn nhất + 1) và ghi ra nhật ký.
 * Từ đó: ảnh đặt tên theo ID, No. anh đánh lại thoải mái.
 */
function ensureIdColumn_() {
  const sheet = ss_().getSheetByName(SHEET_INPUT);
  let L = layout_(sheet);
  if (L.col.id) return;
  const c = L.col.no + 1;
  sheet.insertColumnAfter(L.col.no);
  sheet.getRange(1, c).setValue('ID');
  L = layout_(sheet); // các cột bên phải đã dịch sang 1
  const rows = noNames_(sheet, L, L.col.no);
  const used = {};
  let max = 0;
  rows.forEach(function (r) { if (Number(r[0]) > max) max = Number(r[0]); });
  const later = [];
  const ids = rows.map(function (r, i) {
    if (!String(r[1]).trim()) return [''];
    const n = Number(r[0]);
    if (n > 0 && Math.floor(n) === n && !used[n]) { used[n] = true; return [n]; }
    later.push(i);
    return [''];
  });
  const changed = later.map(function (i) {
    ids[i] = [++max];
    return 'dòng ' + (FIRST_ROW + i) + ' (No. ' + (rows[i][0] === '' ? 'trống' : rows[i][0]) + ') → ID ' + max;
  });
  sheet.getRange(1, c).setFontWeight('bold')
    .setNote('ID cố định của từng chiếc Zippo. Ảnh đặt tên theo số này (12.jpg, 12_2.jpg…). KHÔNG sửa, KHÔNG đánh lại.');
  sheet.getRange(2, c).clearContent();
  sheet.getRange(FIRST_ROW, c, ids.length, 1).setValues(ids).setNumberFormat('0').setBackground('#f1f3f4');
  SpreadsheetApp.flush();
  Logger.log('Đã tạo cột ID (cột ' + c + ' của sheet Zippo).' +
    (changed.length ? ' Các dòng No. trùng/trống được cấp ID mới, ảnh của chúng cần đặt tên theo ID mới: ' + changed.join('; ') : ' Mọi ID đều bằng No. hiện tại.'));
}
