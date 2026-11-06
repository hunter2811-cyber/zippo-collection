/* Bộ sưu tập Zippo — giao diện web. Dữ liệu đến từ Apps Script (xem apps-script/Code.gs). */
(function () {
  'use strict';

  const API = (window.ZC_CONFIG && window.ZC_CONFIG.apiUrl) || '';
  const KEY_STORE = 'zc-key';
  const CACHE_STORE = 'zc-cache-';
  const PREF_STORE = 'zc-prefs';
  const PRIVATE_TITLE = 'Chỉ chủ thấy';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* bộ nhớ trình duyệt bị chặn */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* bỏ qua */ } },
  };

  const ICON = {
    lock: '<svg class="lock" viewBox="0 0 24 24" role="img" aria-label="' + PRIVATE_TITLE + '"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  };

  const state = {
    items: [],
    lists: { cases: [], finishes: [], conditions: [] },
    owner: false,
    key: store.get(KEY_STORE) || '',
    q: '',
    noPhoto: false,
    filters: { collection: new Set(), tag: new Set(), caseType: new Set(), finish: new Set(), codeYear: new Set(), yearPurchase: new Set() },
    open: new Set(), // mở trang: mọi nhóm lọc đều thu gọn
    decadesOpen: new Set(),
    more: new Set(), // nhóm lọc đang mở rộng "Xem thêm"
    sort: 'no-desc',
    view: 'grid',
    page: 'collection',
    shown: [],
    detailIndex: -1,
    photoIndex: 0,
  };

  try {
    const p = JSON.parse(store.get(PREF_STORE) || '{}');
    if (p.view) state.view = p.view;
    if (p.sort) state.sort = p.sort;
  } catch (e) { /* bỏ qua */ }
  const savePrefs = () => store.set(PREF_STORE, JSON.stringify({ view: state.view, sort: state.sort }));

  // ---------- Định dạng ----------
  const money = (k) => (k == null || k === '' ? '' : Math.round(Number(k) * 1000).toLocaleString('vi-VN') + ' đ');
  const dateVN = (s) => (s ? s.split('-').reverse().join('/') : '');
  const img = (id, w) => 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + w;
  const decadeOf = (y) => (y ? Math.floor(y / 10) * 10 : 'none');
  const decadeLabel = (d) => (d === 'none' ? 'Không rõ' : String(d).slice(0, 3) + 'x');

  // ---------- Gọi máy chủ ----------
  async function request(url, opts) {
    try {
      const res = await fetch(url, opts);
      return await res.json();
    } catch (e) {
      throw new Error('Không kết nối được máy chủ, anh kiểm tra mạng rồi thử lại.');
    }
  }
  async function apiGet() {
    return check(await request(API + '?t=' + Date.now(), { redirect: 'follow' }));
  }
  async function apiPost(body) {
    return check(await request(API, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ key: state.key }, body)),
    }));
  }
  function check(data) {
    if (!data || !data.ok) throw new Error((data && data.error) || 'Máy chủ không trả lời.');
    return data;
  }

  function setEmpty(text, action) {
    $('#emptyText').textContent = text;
    $('#emptyAction').textContent = action;
    $('#empty').hidden = false;
  }

  async function load() {
    const cacheKey = CACHE_STORE + (state.key ? 'owner' : 'guest');
    const cached = store.get(cacheKey);
    state.loadFailed = false;
    $('#empty').hidden = true;
    if (cached) {
      try { applyData(JSON.parse(cached)); } catch (e) { /* bỏ qua */ }
    } else {
      $('#summary').textContent = 'Đang tải…';
      renderSkeleton();
    }
    if (!API) {
      $('#summary').textContent = 'Chưa nối với Google Sheet (thiếu apiUrl trong config.js).';
      $('#grid').innerHTML = '';
      return;
    }
    try {
      const data = state.key ? await apiPost({ action: 'list' }) : await apiGet();
      store.set(cacheKey, JSON.stringify(data));
      applyData(data, true);
    } catch (err) {
      if (state.key && /mật khẩu/i.test(err.message)) {
        state.key = '';
        store.del(KEY_STORE);
        toast('Mật khẩu đã đổi, anh đăng nhập lại nhé.');
        return load();
      }
      if (cached) {
        toast('Đang xem bản lưu trên máy (không tải được dữ liệu mới).');
        return;
      }
      state.loadFailed = true;
      $('#grid').innerHTML = '';
      $('#summary').textContent = 'Không tải được dữ liệu.';
      setEmpty(err.message, 'Thử lại');
    }
  }

  // Đọc tên ảnh trong thư mục Anh Zippo: 12.jpg là ảnh chính, 12_2.jpg, 12_3.jpg… là ảnh phụ
  // (vẫn nhận thêm "12 (1).jpg", "12-2.jpg"). Số trong tên ảnh là ID cố định của chiếc Zippo
  // (cột ID trong sheet Zippo), KHÔNG phải No., nên anh đánh lại No. thì ảnh vẫn đúng.
  const pid = (it) => (it.id != null ? it.id : it.no);
  const PHOTO_NAME = /^(\d+)\s*(?:[_\-\s]\s*(\d+)|\(\s*(\d+)\s*\))?\s*\.(jpe?g|png|webp|heic|gif)$/i;
  function attachPhotos(items, files) {
    const map = {};
    // Ảnh rời kiểu cũ (12.jpg, 12_2.jpg) đứng trước, rồi tới ảnh trong thư mục "ID - Tên" xếp theo tên
    const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    files.forEach((f) => {
      const name = String(f.n).trim();
      if (f.k != null) {
        (map[f.k] = map[f.k] || []).push([1, name, f.id]);
        return;
      }
      const m = name.match(PHOTO_NAME);
      if (!m) return;
      const idx = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : 0;
      (map[Number(m[1])] = map[Number(m[1])] || []).push([0, idx, f.id]);
    });
    items.forEach((it) => {
      it.photos = (map[pid(it)] || []).sort((a, b) => a[0] - b[0] || (a[0] ? natural(a[1], b[1]) : a[1] - b[1])).map((e) => e[2]);
    });
  }

  // Phải khớp API_VERSION trong apps-script/Code.gs
  const API_VERSION = 5;

  // Collection và Tag có thể có nhiều giá trị, viết cách nhau bằng dấu phẩy: "Nippon, Hope"
  const MULTI = ['collection', 'tag'];
  const splitList = (s) => {
    const seen = new Set();
    return String(s || '').split(/[,;]/).map((x) => x.trim()).filter((x) => {
      const k = x.toLowerCase();
      if (!x || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const valuesOf = (it, field) => (MULTI.includes(field) ? splitList(it[field]) : [it[field]]).filter((v) => v !== '' && v != null);

  function applyData(data, fresh) {
    if (fresh && data.owner) {
      if ((data.version || 0) < API_VERSION) {
        toast('Apps Script trên Google chưa phải bản mới nhất (đang chạy bản ' + (data.version || 1) + ', cần bản ' + API_VERSION + '). Anh làm lại bước cập nhật Apps Script nhé.');
      }
    }
    state.items = data.items || [];
    state.items.forEach((it) => { if (it.tag == null) it.tag = ''; });
    if (Array.isArray(data.files)) attachPhotos(state.items, data.files);
    state.lists = data.lists || state.lists;
    setOwner(!!data.owner);
    renderFilters();
    render();
    openFromHash();
  }

  function setOwner(on) {
    state.owner = on;
    document.body.classList.toggle('owner', on);
    const btn = $('#accountBtn');
    btn.classList.toggle('is-owner', on);
    btn.setAttribute('aria-label', on ? 'Đang ở chế độ chủ — bấm để thoát' : 'Đăng nhập chủ sở hữu');
    btn.title = on ? 'Chế độ chủ (bấm để thoát)' : 'Đăng nhập chủ sở hữu';
    if (!on) state.filters.yearPurchase.clear();
    renderSortOptions();
  }

  // ---------- Bộ lọc ----------
  function countBy(field) {
    const m = new Map();
    state.items.forEach((it) => valuesOf(it, field).forEach((v) => m.set(v, (m.get(v) || 0) + 1)));
    return m;
  }

  // Đếm theo các bộ lọc đang chọn ở nhóm KHÁC (và ô tìm kiếm) — như bộ lọc của zippo.com
  function facet(field, keyOf) {
    const m = new Map();
    state.items.forEach((it) => {
      if (!matches(it, field)) return;
      (keyOf ? [keyOf(it)] : valuesOf(it, field)).forEach((v) => {
        if (v === '' || v == null) return;
        m.set(v, (m.get(v) || 0) + 1);
      });
    });
    return m;
  }

  function optHtml(group, value, label, count, checked) {
    const off = !count && !checked; // bằng 0 thì làm mờ, không chọn được (trừ mục đang chọn để còn bỏ chọn)
    return '<label class="opt' + (off ? ' is-zero' : '') + '"><input type="checkbox" data-group="' + group + '" value="' + esc(value) + '"' + (checked ? ' checked' : '') + (off ? ' disabled' : '') + '>' +
      '<span class="label">' + esc(label) + '</span><span class="count">' + count + '</span></label>';
  }

  function groupHtml(key, title, body, priv) {
    const open = state.open.has(key);
    const n = state.filters[key].size;
    // Nội dung luôn có sẵn, đóng/mở bằng CSS để thả xuống mượt
    return '<div class="fgroup' + (open ? ' is-open' : '') + '">' +
      '<button type="button" class="fgroup-head" data-toggle="' + key + '" aria-expanded="' + open + '">' +
      '<span>' + esc(title) + '</span>' + (priv ? ICON.lock : '') +
      (n ? '<span class="badge">' + n + '</span>' : '') + ICON.down + '</button>' +
      '<div class="fgroup-wrap"' + (open ? '' : ' inert') + '><div class="fgroup-body">' + body + '</div></div></div>';
  }

  const filterKey = (el) => [el.tagName, el.dataset.group, el.dataset.decade, el.dataset.toggle, el.dataset.more, el.dataset.decadeOpen, el.dataset.year, el.value].join('|');

  function renderFilters() {
    const f = state.filters;
    const html = [];

    // Nhóm lọc theo giá trị thật trong sheet, nhiều nhất lên đầu; dài quá thì hiện 10–12 mục + "Xem thêm"
    const limit = window.matchMedia('(max-width: 799px)').matches ? 12 : 10;
    const valueGroup = (key, title) => {
      const totals = countBy(key);
      const now = facet(key);
      const all = Array.from(totals.keys()).map((v) => [v, now.get(v) || 0, totals.get(v)])
        .sort((a, b) => b[1] - a[1] || b[2] - a[2] || String(a[0]).localeCompare(String(b[0])));
      if (!all.length) return;
      const open = state.more.has(key);
      const collapse = all.length > limit + 3; // chỉ thu gọn khi dư nhiều, tránh "Xem thêm 1 loại"
      const visible = open || !collapse ? all : all.filter((e, i) => i < limit || f[key].has(e[0]));
      let body = visible.map(([v, n]) => optHtml(key, v, v, n, f[key].has(v))).join('');
      if (collapse) {
        body += '<button type="button" class="link-btn more-btn" data-more="' + key + '">' +
          (open ? 'Thu gọn' : 'Xem thêm ' + (all.length - limit) + ' loại') + '</button>';
      }
      html.push(groupHtml(key, title, body));
    };
    valueGroup('collection', 'Collection');
    valueGroup('tag', 'Tag');
    valueGroup('caseType', 'Case');
    valueGroup('finish', 'Finish');

    // Code Year: nhóm theo thập niên, mở ra từng năm
    const years = new Map();
    state.items.forEach((it) => {
      const d = decadeOf(it.codeYear);
      if (!years.has(d)) years.set(d, new Map());
      years.get(d).set(it.codeYear || 'none', 0);
    });
    facet('codeYear', (it) => it.codeYear || 'none').forEach((n, y) => years.get(decadeOf(y === 'none' ? null : y)).set(y, n));
    const decades = Array.from(years.keys()).sort((a, b) => (a === 'none') - (b === 'none') || a - b);
    const cyBody = decades.map((d) => {
      const ys = Array.from(years.get(d)).sort((a, b) => a[0] - b[0]);
      const total = ys.reduce((s, e) => s + e[1], 0);
      const allOn = ys.every(([y]) => f.codeYear.has(String(y)));
      const someOn = ys.some(([y]) => f.codeYear.has(String(y)));
      const open = state.decadesOpen.has(String(d));
      const off = !total && !someOn;
      let out = '<div class="decade"><div class="decade-row">' +
        '<label class="opt' + (off ? ' is-zero' : '') + '"><input type="checkbox" data-decade="' + d + '"' + (allOn ? ' checked' : '') + (someOn && !allOn ? ' data-partial' : '') + (off ? ' disabled' : '') + '>' +
        '<span class="label">' + decadeLabel(d) + '</span><span class="count">' + total + '</span></label>';
      if (d !== 'none') {
        out += '<button type="button" class="decade-toggle" data-decade-open="' + d + '" aria-expanded="' + open + '" aria-label="Xem từng năm ' + decadeLabel(d) + '">' + (open ? ICON.up : ICON.down) + '</button>';
      }
      out += '</div>';
      if (open) {
        out += '<div class="decade-years">' + ys.map(([y, n]) => {
          const on = f.codeYear.has(String(y));
          return '<button type="button" class="chip' + (on ? ' is-on' : '') + (!n && !on ? ' is-zero' : '') + '" data-year="' + y + '" aria-pressed="' + on + '"' + (!n && !on ? ' disabled' : '') + '>' + y + ' <span class="count">' + n + '</span></button>';
        }).join('') + '</div>';
      }
      return out + '</div>';
    }).join('');
    html.push(groupHtml('codeYear', 'Code Year', cyBody));

    if (state.owner) {
      const now = facet('yearPurchase');
      const yp = Array.from(countBy('yearPurchase').keys()).sort((a, b) => a - b);
      html.push(groupHtml('yearPurchase', 'Năm mua', yp.map((v) => optHtml('yearPurchase', v, v, now.get(v) || 0, f.yearPurchase.has(String(v)))).join(''), true));
    }

    // Vẽ lại làm mất ô đang focus, nên tìm lại đúng ô đó (có thể đã đổi chỗ vì xếp theo số đếm)
    const active = document.activeElement;
    const focused = $('#filterGroups').contains(active) ? filterKey(active) : null;
    const headKey = focused && active.closest('.fgroup').querySelector('.fgroup-head').dataset.toggle;
    $('#filterGroups').innerHTML = html.join('');
    $$('#filterGroups input[data-partial]').forEach((el) => { el.indeterminate = true; });
    if (focused) {
      const same = $$('#filterGroups input, #filterGroups button').find((el) => !el.disabled && filterKey(el) === focused);
      (same || $('#filterGroups [data-toggle="' + headKey + '"]')).focus();
    }
    const total = Object.values(f).reduce((s, set) => s + set.size, 0);
    const badge = $('#filterBadge');
    badge.hidden = !total;
    badge.textContent = total;
  }

  $('#filterGroups').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.toggle) {
      const k = t.dataset.toggle;
      const on = !state.open.has(k);
      on ? state.open.add(k) : state.open.delete(k);
      const g = t.closest('.fgroup');
      g.classList.toggle('is-open', on);
      t.setAttribute('aria-expanded', on);
      g.querySelector('.fgroup-wrap').inert = !on;
      return;
    } else if (t.dataset.more) {
      const k = t.dataset.more;
      state.more.has(k) ? state.more.delete(k) : state.more.add(k);
    } else if (t.dataset.decadeOpen) {
      const d = t.dataset.decadeOpen;
      state.decadesOpen.has(d) ? state.decadesOpen.delete(d) : state.decadesOpen.add(d);
    } else if (t.dataset.year) {
      const s = state.filters.codeYear;
      s.has(t.dataset.year) ? s.delete(t.dataset.year) : s.add(t.dataset.year);
      render();
    } else return;
    renderFilters();
  });

  $('#filterGroups').addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.group) {
      const s = state.filters[el.dataset.group];
      el.checked ? s.add(el.value) : s.delete(el.value);
    } else if (el.dataset.decade) {
      const d = el.dataset.decade;
      state.items.forEach((it) => {
        if (String(decadeOf(it.codeYear)) !== d) return;
        const y = String(it.codeYear || 'none');
        el.checked ? state.filters.codeYear.add(y) : state.filters.codeYear.delete(y);
      });
    }
    renderFilters();
    render();
  });

  function clearFilters() {
    clearTimeout(qTimer);
    state.q = '';
    state.noPhoto = false;
    $('#q').value = '';
    Object.values(state.filters).forEach((s) => s.clear());
    renderFilters();
    render();
  }
  $('#clearFilters').addEventListener('click', clearFilters);
  $('#sheetClear').addEventListener('click', clearFilters);
  $('#emptyAction').addEventListener('click', () => {
    if (state.loadFailed) load(); else clearFilters();
    $('#main').focus({ preventScroll: true });
  });

  // Tấm lọc trên điện thoại. Chỉ là hộp thoại khi đang mở; trên máy tính đây là cột lọc thường.
  const sheet = $('#filters');
  const sheetIsOpen = () => sheet.classList.contains('is-open');
  function openSheet(open) {
    if (open === sheetIsOpen()) return;
    sheet.classList.toggle('is-open', open);
    $('#filtersBackdrop').hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
    $('#openFilters').setAttribute('aria-expanded', open);
    if (open) {
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
    } else {
      sheet.removeAttribute('role');
      sheet.removeAttribute('aria-modal');
    }
    $$('.topbar, .content, .bottom-nav').forEach((el) => { el.inert = open; });
    $(open ? '#closeFilters' : '#openFilters').focus();
  }
  $('#openFilters').addEventListener('click', () => openSheet(true));
  $('#closeFilters').addEventListener('click', () => openSheet(false));
  $('#sheetApply').addEventListener('click', () => openSheet(false));
  $('#filtersBackdrop').addEventListener('click', () => openSheet(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSheet(false); });
  window.matchMedia('(max-width: 799px)').addEventListener('change', (e) => { if (!e.matches) openSheet(false); });

  // ---------- Danh sách ----------
  const SORTS = [
    ['no-desc', 'Mới nhập trước'],
    ['no-asc', 'No. tăng dần'],
    ['cy-asc', 'Code Year: cũ → mới'],
    ['cy-desc', 'Code Year: mới → cũ'],
    ['name', 'Tên A → Z'],
    ['price-desc', 'Giá cao → thấp', true],
    ['date-desc', 'Ngày mua gần nhất', true],
  ];
  function renderSortOptions() {
    const opts = SORTS.filter((s) => state.owner || !s[2]);
    if (!opts.some((s) => s[0] === state.sort)) state.sort = 'no-desc';
    $('#sort').innerHTML = opts.map((s) => '<option value="' + s[0] + '"' + (s[0] === state.sort ? ' selected' : '') + '>' + s[1] + '</option>').join('');
  }
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; savePrefs(); render(); });

  // skip: bỏ qua bộ lọc của nhóm này (dùng để đếm số lượng cho chính nhóm đó)
  function matches(it, skip) {
    const f = state.filters;
    const any = (field) => valuesOf(it, field).some((v) => f[field].has(v));
    if (skip !== 'collection' && f.collection.size && !any('collection')) return false;
    if (skip !== 'tag' && f.tag.size && !any('tag')) return false;
    if (skip !== 'caseType' && f.caseType.size && !f.caseType.has(it.caseType)) return false;
    if (skip !== 'finish' && f.finish.size && !f.finish.has(it.finish)) return false;
    if (skip !== 'codeYear' && f.codeYear.size && !f.codeYear.has(String(it.codeYear || 'none'))) return false;
    if (skip !== 'yearPurchase' && f.yearPurchase.size && !f.yearPurchase.has(String(it.yearPurchase))) return false;
    if (state.noPhoto && it.photos && it.photos.length) return false;
    if (state.q) {
      const hay = [it.no, it.name, it.sku, it.collection, it.tag, it.caseType, it.finish, it.code, it.codeYear, it.note, it.buyFrom, it.origin].join(' ').toLowerCase();
      const words = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.every((w) => hay.includes(w) || hay.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(w.normalize('NFD').replace(/[̀-ͯ]/g, '')))) return false;
    }
    return true;
  }

  function sorter() {
    const nullLast = (a, b, dir) => (a == null) - (b == null) || (a == null ? 0 : dir * (a - b));
    switch (state.sort) {
      case 'no-asc': return (a, b) => a.no - b.no;
      case 'cy-asc': return (a, b) => nullLast(a.codeYear, b.codeYear, 1) || a.no - b.no;
      case 'cy-desc': return (a, b) => nullLast(a.codeYear, b.codeYear, -1) || b.no - a.no;
      case 'name': return (a, b) => a.name.localeCompare(b.name, 'vi');
      case 'price-desc': return (a, b) => nullLast(a.price, b.price, -1);
      case 'date-desc': return (a, b) => (b.date || '').localeCompare(a.date || '') || b.no - a.no;
      default: return (a, b) => b.no - a.no;
    }
  }

  // Trong trang chi tiết, chiếc chưa có ảnh hiện mã đáy của chính nó
  function stampHtml(it) {
    const code = String(it.code || '—');
    return '<span class="stamp' + (it.code ? '' : ' is-none') + '" style="--len:' + Math.max(code.length, 3) + '" aria-hidden="true">' + esc(code) + '</span>' +
      (it.codeYear ? '<span class="stamp-year">' + esc(it.codeYear) + '</span>' : '');
  }

  // Ô giống bản đang chạy: số # và số ảnh nằm trên ảnh; dưới ảnh là tên, Case · Finish, rồi mã và giá
  function cardHtml(it, i) {
    const photo = it.photos && it.photos[0];
    const meta = [it.caseType, it.finish].filter(Boolean).join(' · ');
    return '<button type="button" class="card' + (photo ? '' : ' is-stamped') + '" data-i="' + i + '" aria-label="' + esc('Xem chi tiết #' + it.no + ' ' + it.name + (it.code ? ', mã ' + it.code : '')) + '">' +
      '<div class="card-img">' + (photo ? '<img loading="lazy" decoding="async" src="' + img(photo, 600) + '" alt="">' : '') +
      '<span class="no-badge">#' + it.no + '</span></div>' +
      '<div class="card-body"><h3>' + esc(it.name).replace(/ - /g, '&nbsp;- ') + '</h3><p class="meta">' + esc(meta || '—') + '</p>' +
      '<div class="foot"><span class="code">' + esc(it.code || '—') + '</span>' +
      (state.owner && it.price ? '<span class="price">' + money(it.price) + '</span>' : '') + '</div></div></button>';
  }

  function render() {
    if (state.loadFailed) return;
    state.shown = state.items.filter((it) => matches(it)).sort(sorter());
    const grid = $('#grid');
    grid.classList.toggle('is-list', state.view === 'list');
    grid.innerHTML = state.shown.map(cardHtml).join('');
    if (state.shown.length || !state.items.length) $('#empty').hidden = true;
    else setEmpty('Không có chiếc Zippo nào khớp.', 'Xoá tìm kiếm và bộ lọc');
    $('#sheetApply').textContent = 'Xem ' + state.shown.length + ' chiếc';
    const parts = [];
    const f = state.filters;
    if (f.collection.size) parts.push(Array.from(f.collection).join(', '));
    if (f.tag.size) parts.push('Tag: ' + Array.from(f.tag).join(', '));
    if (f.caseType.size) parts.push('Case: ' + Array.from(f.caseType).join(', '));
    if (f.finish.size) parts.push(Array.from(f.finish).join(', '));
    $('#summary').innerHTML = '<strong>' + state.shown.length + '</strong> / ' + state.items.length + ' chiếc' + (parts.length ? ' · ' + esc(parts.join(' · ')) : '');
    renderActiveChips();
    renderOverview();
    $$('.view-switch .icon-btn').forEach((b) => {
      const on = b.dataset.view === state.view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on);
    });
    if (state.page === 'stats') renderStats();
  }

  // Dải tổng quan đầu trang: chỉ hiện khi chưa lọc, chưa tìm
  function renderOverview() {
    const f = state.filters;
    const busy = state.q || state.noPhoto || Object.keys(f).some((g) => f[g].size);
    const ov = $('#overview');
    ov.hidden = !!busy || !state.items.length;
    if (ov.hidden) return;
    const total = state.items.length;
    const withPhoto = state.items.filter((it) => it.photos && it.photos.length).length;
    $('#ovNum').textContent = total;
    $('#ovPhotoTxt').textContent = withPhoto + ' / ' + total;
    $('#ovBar').style.width = (100 * withPhoto / total).toFixed(1) + '%';
    $('#ovNoPhoto').hidden = withPhoto === total;
    const recent = state.items.slice().sort((a, b) => (b.no || 0) - (a.no || 0)).slice(0, 4);
    $('#ovRecent').innerHTML = recent.map((it) => '<button type="button" class="ov-item" data-pid="' + pid(it) + '">' +
      '<span class="ov-img">' + (it.photos && it.photos[0] ? '<img loading="lazy" src="' + img(it.photos[0], 400) + '" alt="">' : '') + '</span>' +
      '<span class="ov-name">' + esc(it.name) + '</span><span class="ov-meta">#' + it.no + ' · ' + esc(it.code || '—') + '</span></button>').join('');
  }
  $('#ovNoPhoto').addEventListener('click', () => { state.noPhoto = true; render(); $('#main').focus({ preventScroll: true }); });
  $('#ovRecent').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pid]');
    if (!b) return;
    const i = state.shown.findIndex((x) => pid(x) === Number(b.dataset.pid));
    if (i >= 0) openDetail(i);
  });

  // Chế độ tối: nhớ trên từng máy
  const THEME_STORE = 'zc-theme';
  function setTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const b = $('#themeBtn');
    b.setAttribute('aria-pressed', dark);
    b.setAttribute('aria-label', dark ? 'Tắt chế độ tối' : 'Bật chế độ tối');
    b.innerHTML = dark ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#0e0d0c' : '#141414';
  }
  setTheme(store.get(THEME_STORE) === 'dark');
  $('#themeBtn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    store.set(THEME_STORE, dark ? 'dark' : 'light');
    setTheme(dark);
  });

  function renderActiveChips() {
    const out = [];
    const names = { collection: '', tag: '#', caseType: '', finish: '', codeYear: 'Code ', yearPurchase: 'Mua ' };
    Object.keys(state.filters).forEach((g) => state.filters[g].forEach((v) => {
      out.push('<button type="button" class="chip is-on" data-chip-group="' + g + '" data-chip-value="' + esc(v) + '" aria-label="Bỏ lọc ' + esc(v) + '">' +
        esc(names[g] + (v === 'none' ? 'không rõ' : v)) + ' <span aria-hidden="true">×</span></button>');
    }));
    if (state.noPhoto) out.push('<button type="button" class="chip is-on" data-chip-nophoto aria-label="Bỏ lọc chưa có ảnh">Chưa có ảnh <span aria-hidden="true">×</span></button>');
    if (state.q) out.push('<button type="button" class="chip is-on" data-chip-q aria-label="Bỏ tìm kiếm">“' + esc(state.q) + '” <span aria-hidden="true">×</span></button>');
    $('#activeChips').innerHTML = out.join('');
  }
  $('#activeChips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    const at = $$('#activeChips .chip').indexOf(c);
    if (c.hasAttribute('data-chip-nophoto')) state.noPhoto = false;
    else if (c.hasAttribute('data-chip-q')) { state.q = ''; $('#q').value = ''; }
    else state.filters[c.dataset.chipGroup].delete(c.dataset.chipValue);
    renderFilters();
    render();
    const chips = $$('#activeChips .chip');
    (chips[Math.min(at, chips.length - 1)] || $('#main')).focus({ preventScroll: true });
  });

  function renderSkeleton() {
    $('#grid').innerHTML = Array.from({ length: 10 }, () => '<div class="skeleton"></div>').join('');
  }

  let qTimer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); renderFilters(); render(); }, 150);
  });
  $$('.view-switch .icon-btn').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; savePrefs(); render(); }));
  $('#grid').addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (c) openDetail(Number(c.dataset.i));
  });

  // ---------- Chi tiết ----------
  const detail = $('#detail');

  function focusCard(i) {
    const c = $('.card[data-i="' + i + '"]');
    if (c) c.focus();
  }

  function openDetail(i) {
    if (i < 0 || i >= state.shown.length) return;
    state.detailIndex = i;
    state.photoIndex = 0;
    fillDetail();
    if (!detail.open) detail.showModal();
    history.replaceState(null, '', '#id=' + pid(state.shown[i]));
  }

  function factRows(rows) {
    return rows.filter((r) => r[1] !== '' && r[1] != null).map((r) => '<dt>' + esc(r[0]) + '</dt><dd' + (r[2] ? ' class="' + r[2] + '"' : '') + '>' + esc(r[1]) + '</dd>').join('');
  }

  function fillDetail() {
    const it = state.shown[state.detailIndex];
    if (!it) return;
    $('#dNo').textContent = '#' + it.no;
    $('#dTitle').textContent = it.name;
    $('#dFacts').innerHTML = factRows([
      ['Code', it.code || '—', 'code'], ['Code Year', it.codeYear || ''], ['Case', it.caseType], ['Finish', it.finish], ['Collection', splitList(it.collection).join(', ')], ['Tag', splitList(it.tag).join(', ')], ['SKU', it.sku],
    ]);
    if (state.owner) {
      $('#dPrivate').innerHTML = '<h3>' + ICON.lock + 'Riêng tư</h3><dl class="facts">' + factRows([
        ['Giá mua', money(it.price)], ['Ngày mua', dateVN(it.date) || (it.yearPurchase || '')], ['Tình trạng vỏ', it.caseCond],
        ['Tình trạng ruột', it.insertsCond], ['Mua tại', it.buyFrom], ['Xuất xứ', it.origin], ['ID ảnh', pid(it)],
      ]) + '</dl>' + (it.note ? '<p class="note">' + esc(it.note) + '</p>' : '');
    }
    fillDetailPhoto();
    $('#dPrev').disabled = state.detailIndex === 0;
    $('#dNext').disabled = state.detailIndex === state.shown.length - 1;
    // Ảnh nhỏ vừa bị vẽ lại hoặc nút vừa bị khoá thì focus rơi mất, đưa về tên chiếc Zippo
    const a = document.activeElement;
    if (detail.open && (a.disabled || !detail.contains(a))) $('#dTitle').focus({ preventScroll: true });
  }

  function fillDetailPhoto() {
    const it = state.shown[state.detailIndex];
    const photos = it.photos || [];
    const id = photos[state.photoIndex];
    $('#dImg').innerHTML = (id ? '<img src="' + img(id, 1600) + '" alt="' + esc(it.name) + '">' : stampHtml(it)) +
      (photos.length > 1 ? '<span class="pcounter">' + (state.photoIndex + 1) + ' / ' + photos.length + '</span><span class="pdots" aria-hidden="true">' + photos.map((p, i) => '<i' + (i === state.photoIndex ? ' class="on"' : '') + '></i>').join('') + '</span>' : '');
    $('#dImg').classList.remove('is-zoom');
    $('#dThumbs').innerHTML = photos.length > 1 ? photos.map((p, i) => '<button type="button" class="' + (i === state.photoIndex ? 'is-on' : '') + '" data-p="' + i + '" aria-label="Ảnh ' + (i + 1) + '"' + (i === state.photoIndex ? ' aria-current="true"' : '') + '><img loading="lazy" src="' + img(p, 200) + '" alt=""></button>').join('') : '';
  }

  $('#dThumbs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.photoIndex = Number(b.dataset.p);
    fillDetailPhoto();
    $('#dThumbs [data-p="' + state.photoIndex + '"]').focus();
  });
  $('#dPrev').addEventListener('click', () => openDetail(state.detailIndex - 1));
  $('#dNext').addEventListener('click', () => openDetail(state.detailIndex + 1));
  document.addEventListener('keydown', (e) => {
    if (!detail.open || $('dialog[open]:not(#detail)')) return;
    if (e.key === 'ArrowLeft') openDetail(state.detailIndex - 1);
    if (e.key === 'ArrowRight') openDetail(state.detailIndex + 1);
  });
  detail.addEventListener('close', () => {
    history.replaceState(null, '', location.pathname + location.search);
    if (!$('dialog[open]')) focusCard(state.detailIndex);
  });
  // Chạm hai lần (hoặc nhấp đúp) để phóng to chỗ vừa chạm
  $('#dImg').addEventListener('dblclick', (e) => {
    const box = $('#dImg');
    const im = box.querySelector('img');
    if (!im) return;
    const r = im.getBoundingClientRect();
    im.style.transformOrigin = ((e.clientX - r.left) / r.width * 100).toFixed(0) + '% ' + ((e.clientY - r.top) / r.height * 100).toFixed(0) + '%';
    box.classList.toggle('is-zoom');
  });
  $('#dShare').addEventListener('click', async () => {
    const it = state.shown[state.detailIndex];
    const url = location.href.split('#')[0] + '#id=' + pid(it);
    try {
      if (navigator.share) await navigator.share({ title: it.name, url });
      else { await navigator.clipboard.writeText(url); toast('Đã chép đường link của #' + it.no); }
    } catch (err) { toast('Đường link: ' + url); }
  });
  $('#dEdit').addEventListener('click', () => { const it = state.shown[state.detailIndex]; detail.close(); openEditor(it); });
  $('#dDelete').addEventListener('click', () => deleteItem(state.shown[state.detailIndex]));

  // Vuốt trái/phải để chuyển chiếc trên điện thoại
  let touchX = null;
  $('#dImg').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('#dImg').addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    const photos = state.shown[state.detailIndex].photos || [];
    if (Math.abs(dx) < 50 || photos.length < 2) return;
    state.photoIndex = (state.photoIndex + (dx < 0 ? 1 : -1) + photos.length) % photos.length;
    fillDetailPhoto();
  });

  function openFromHash() {
    // #id=12 (link cũ dạng #no=12 vẫn mở được)
    const m = location.hash.match(/(id|no)=(\d+)/);
    if (!m || detail.open) return;
    const i = state.shown.findIndex((it) => (m[1] === 'id' ? pid(it) : it.no) === Number(m[2]));
    if (i >= 0) openDetail(i);
  }

  // Đóng hộp thoại khi bấm nút có data-close hoặc bấm ra ngoài
  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (!e.target.closest('[data-close]') && e.target !== d) return;
      if (d === editor) closeEditor(); else d.close();
    });
  });

  // ---------- Đăng nhập ----------
  $('#accountBtn').addEventListener('click', () => {
    if (state.owner) {
      if (!confirm('Thoát chế độ chủ trên máy này?')) return;
      state.key = '';
      store.del(KEY_STORE);
      store.del(CACHE_STORE + 'owner');
      setOwner(false);
      load();
      return;
    }
    $('#lError').textContent = '';
    $('#lPass').value = '';
    showPass(false);
    $('#login').showModal();
  });

  function showPass(on) {
    $('#lPass').type = on ? 'text' : 'password';
    $('#lShow').setAttribute('aria-pressed', on);
    $('#lShow').setAttribute('aria-label', on ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
  }
  $('#lShow').addEventListener('click', () => { showPass($('#lPass').type === 'password'); $('#lPass').focus(); });

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter || $('#loginForm button[type=submit]');
    btn.disabled = true;
    try {
      state.key = $('#lPass').value;
      await apiPost({ action: 'login' });
      store.set(KEY_STORE, state.key);
      $('#login').close();
      toast('Đã vào chế độ chủ.');
      await load();
    } catch (err) {
      state.key = '';
      $('#lError').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- Thêm / sửa ----------
  const editor = $('#editor');
  let editing = null; // món đang sửa (null = thêm mới)
  let queued = []; // ảnh mới chờ tải lên: {file, url}
  let saving = false;
  let cleanForm = ''; // form lúc mới mở, để biết anh đã sửa gì chưa

  const snapshot = () => JSON.stringify(readForm());
  const editorDirty = () => queued.length > 0 || snapshot() !== cleanForm;

  async function closeEditor() {
    if (saving) return;
    if (editorDirty() && !(await ask('Bỏ thay đổi chưa lưu?', 'Những gì anh vừa nhập trong form này sẽ mất.', 'Bỏ thay đổi', 'Tiếp tục sửa'))) return;
    editor.close();
  }
  // Chrome không cho chặn cancel mọi lúc nên form đặt closedby="none" và tự bắt Esc; cancel dành cho trình duyệt chưa có closedby
  editor.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeEditor(); } });
  editor.addEventListener('cancel', (e) => { e.preventDefault(); closeEditor(); });
  window.addEventListener('beforeunload', (e) => { if (editor.open && (saving || editorDirty())) e.preventDefault(); });

  function setStatus(msg, isError) {
    $('#eStatus').textContent = msg || '';
    $('#eStatus').classList.toggle('is-error', !!isError);
  }

  function fieldError(sel, msg) {
    const input = $(sel);
    const box = input.closest('.field');
    const note = $('.field-error', box);
    box.classList.toggle('invalid', !!msg);
    note.textContent = msg || '';
    note.hidden = !msg;
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }
  ['#fName', '#fNo', '#fPrice'].forEach((sel) => $(sel).addEventListener('input', () => fieldError(sel)));

  function fillSelect(sel, options, value, withOther) {
    const opts = options.slice();
    const known = !value || opts.includes(value);
    let html = '<option value="">—</option>' + opts.map((o) => '<option' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
    if (withOther) html += '<option value="__other"' + (!known ? ' selected' : '') + '>Khác (tự nhập)…</option>';
    else if (!known) html += '<option selected>' + esc(value) + '</option>';
    sel.innerHTML = html;
    return known;
  }

  // Ô nhập nhiều giá trị: gõ rồi Enter hoặc dấu phẩy để thêm, bấm × để bỏ
  function tokenInput(boxId, inputId) {
    const box = $('#' + boxId);
    const input = $('#' + inputId);
    let vals = [];
    const draw = () => {
      $$('.tok', box).forEach((t) => t.remove());
      vals.forEach((v, i) => {
        const t = document.createElement('span');
        t.className = 'tok';
        t.innerHTML = esc(v) + '<button type="button" data-i="' + i + '" aria-label="Bỏ ' + esc(v) + '">×</button>';
        box.insertBefore(t, input);
      });
    };
    const add = (text) => {
      splitList(text).forEach((v) => { if (!vals.some((x) => x.toLowerCase() === v.toLowerCase())) vals.push(v); });
      input.value = '';
      draw();
    };
    input.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) { e.preventDefault(); add(input.value); }
      else if (e.key === 'Enter') e.preventDefault();
      else if (e.key === 'Backspace' && !input.value && vals.length) { vals.pop(); draw(); }
    });
    input.addEventListener('change', () => { if (input.value.trim()) add(input.value); });
    input.addEventListener('input', (e) => { if (e.inputType === 'insertReplacementText' || !e.inputType) add(input.value); });
    input.addEventListener('blur', () => { if (input.value.trim()) add(input.value); });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) { vals.splice(Number(b.dataset.i), 1); draw(); } else input.focus();
    });
    return {
      set(list) { vals = list.slice(); input.value = ''; draw(); },
      get() { if (input.value.trim()) add(input.value); return vals.slice(); },
    };
  }
  const tokens = { collection: tokenInput('tkCollection', 'fCollection'), tag: tokenInput('tkTag', 'fTag') };

  function uniq(field) {
    return Array.from(new Set(state.items.map((it) => it[field]).filter(Boolean))).sort();
  }

  function openEditor(it) {
    editing = it || null;
    queued.forEach((q) => URL.revokeObjectURL(q.url));
    queued = [];
    const v = it || {};
    $('#eTitle').textContent = it ? 'Sửa Zippo · No. ' + it.no : 'Thêm Zippo';
    $('#eSave').textContent = it ? 'Lưu thay đổi' : 'Thêm vào bộ sưu tập';
    $('#fName').value = v.name || '';
    $('#fSku').value = v.sku || '';
    $('#fNo').value = it && it.no != null ? it.no : '';
    $('#fNo').placeholder = 'Tự động: ' + (state.items.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1);
    const caseKnown = fillSelect($('#fCase'), state.lists.cases, v.caseType, true);
    $('#fCaseOther').hidden = caseKnown;
    $('#fCaseOther').value = caseKnown ? '' : v.caseType;
    const finKnown = fillSelect($('#fFinish'), state.lists.finishes, v.finish, true);
    $('#fFinishOther').hidden = finKnown;
    $('#fFinishOther').value = finKnown ? '' : v.finish;
    $('#fLeft').value = v.left || '';
    $('#fRight').value = v.right || '';
    $('#fPrice').value = v.price != null ? v.price : '';
    $('#fDate').value = v.date || (it ? '' : new Date().toISOString().slice(0, 10));
    fillSelect($('#fCaseCond'), state.lists.conditions, v.caseCond || (it ? '' : 'New'));
    fillSelect($('#fInsertsCond'), state.lists.conditions, v.insertsCond || (it ? '' : 'New'));
    $('#fBuyFrom').value = v.buyFrom || '';
    $('#fOrigin').value = v.origin || '';
    tokens.collection.set(splitList(v.collection));
    tokens.tag.set(splitList(v.tag));
    $('#fNote').value = v.note || '';
    $('#dlBuyFrom').innerHTML = uniq('buyFrom').map((o) => '<option value="' + esc(o) + '">').join('');
    $('#dlOrigin').innerHTML = uniq('origin').map((o) => '<option value="' + esc(o) + '">').join('');
    $('#dlCollection').innerHTML = Array.from(countBy('collection').keys()).sort().map((o) => '<option value="' + esc(o) + '">').join('');
    $('#dlTag').innerHTML = Array.from(countBy('tag').keys()).sort().map((o) => '<option value="' + esc(o) + '">').join('');
    ['#fName', '#fNo', '#fPrice'].forEach((sel) => fieldError(sel));
    setStatus('');
    updateCodeYear();
    renderPhotos();
    cleanForm = snapshot();
    editor.showModal();
    editor.querySelector('.editor-body').scrollTop = 0;
  }

  $('#fCase').addEventListener('change', (e) => { $('#fCaseOther').hidden = e.target.value !== '__other'; if (e.target.value === '__other') $('#fCaseOther').focus(); });
  $('#fFinish').addEventListener('change', (e) => { $('#fFinishOther').hidden = e.target.value !== '__other'; if (e.target.value === '__other') $('#fFinishOther').focus(); });

  // Xem trước Code Year (máy chủ vẫn tính chính xác bằng công thức trong sheet)
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI'];
  function guessCodeYear(left, right) {
    const month = 'ABCDEFGHIJKL'.indexOf(left.toUpperCase()) + 1;
    let year = null;
    if (/^\d{1,2}$/.test(right)) year = 2000 + Number(right);
    else if (ROMAN.includes(right.toUpperCase())) year = 1985 + ROMAN.indexOf(right.toUpperCase());
    return month && year ? { month, year } : null;
  }
  function updateCodeYear() {
    const l = $('#fLeft').value.trim();
    const r = $('#fRight').value.trim();
    const g = guessCodeYear(l, r);
    $('#fCodeYear').textContent = g ? 'Code Year: ' + l.toUpperCase() + '-' + r + ' → tháng ' + g.month + '/' + g.year
      : (l || r ? 'Code Year sẽ do công thức trong sheet tính khi lưu' : 'Code Year tự tính khi lưu');
  }
  $('#fLeft').addEventListener('input', updateCodeYear);
  $('#fRight').addEventListener('input', updateCodeYear);

  function renderPhotos() {
    const existing = (editing && editing.photos) || [];
    const html = existing.map((id, i) => '<div class="pitem' + (i === 0 ? ' is-main' : '') + '"><img src="' + img(id, 300) + '" alt="Ảnh ' + (i + 1) + '">' +
      (i === 0 ? '<span class="tag">Ảnh chính</span>' : '') + '<div class="acts">' +
      (i > 0 ? '<button type="button" data-main="' + id + '" aria-label="Đặt làm ảnh chính" title="Đặt làm ảnh chính">' + ICON.star + '</button>' : '') +
      '<button type="button" data-del="' + id + '" aria-label="Xoá ảnh" title="Xoá ảnh">' + ICON.trash + '</button></div></div>')
      .concat(queued.map((q, i) => '<div class="pitem"><img src="' + q.url + '" alt=""><span class="tag new">Mới</span><div class="acts">' +
        '<button type="button" data-unqueue="' + i + '" aria-label="Bỏ ảnh này" title="Bỏ ảnh này">' + ICON.trash + '</button></div></div>'));
    $('#ePhotos').innerHTML = html.join('');
    const id = editing ? pid(editing) : 'ID';
    $('#dropHint').textContent = 'Ảnh được lưu vào thư mục “No. - Tên Zippo - ID ' + id + '” trong Anh Zippo khi bấm Lưu.' +
      (editing ? '' : ' (Zippo mới được cấp ID tự động.)');
  }

  function addFiles(files) {
    Array.from(files).filter((f) => f.type.startsWith('image/')).forEach((file) => queued.push({ file, url: URL.createObjectURL(file) }));
    renderPhotos();
  }
  $('#eFiles').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  $('#ePhotos').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.unqueue) {
      const q = queued.splice(Number(b.dataset.unqueue), 1)[0];
      URL.revokeObjectURL(q.url);
      renderPhotos();
      return;
    }
    const id = pid(editing);
    try {
      b.disabled = true;
      let res;
      if (b.dataset.del) {
        if (!(await ask('Xoá ảnh này?', 'Ảnh sẽ được chuyển vào Thùng rác của Google Drive (khôi phục được trong 30 ngày).'))) { b.disabled = false; return; }
        res = await apiPost({ action: 'deletePhoto', pid: id, no: id, id: b.dataset.del });
      } else if (b.dataset.main) {
        res = await apiPost({ action: 'setMainPhoto', pid: id, no: id, id: b.dataset.main });
      }
      editing.photos = res.photos;
      const item = state.items.find((x) => pid(x) === id);
      if (item) item.photos = res.photos;
      renderPhotos();
      render();
    } catch (err) {
      toast('Lỗi: ' + err.message);
      b.disabled = false;
    }
  });

  // Thu nhỏ ảnh máy ảnh (thường 5–10 MB) còn ~2000px trước khi gửi
  async function toJpegBase64(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (!bmp) {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { data: btoa(bin), mime: file.type || 'image/jpeg' };
    }
    const max = 2000;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', 0.88);
    return { data: url.slice(url.indexOf(',') + 1), mime: 'image/jpeg' };
  }

  function readForm() {
    const pick = (sel, other) => ($(sel).value === '__other' ? $(other).value.trim() : $(sel).value);
    const price = $('#fPrice').value.trim().replace(/\./g, '').replace(',', '.');
    const no = $('#fNo').value.trim();
    return {
      id: editing ? pid(editing) : undefined,
      no: /^\d+$/.test(no) ? Number(no) : undefined,
      name: $('#fName').value.trim(),
      sku: $('#fSku').value.trim(),
      caseType: pick('#fCase', '#fCaseOther'),
      finish: pick('#fFinish', '#fFinishOther'),
      left: $('#fLeft').value.trim().toUpperCase(),
      right: $('#fRight').value.trim(),
      price: price === '' ? '' : Number(price),
      date: $('#fDate').value,
      caseCond: $('#fCaseCond').value,
      insertsCond: $('#fInsertsCond').value,
      buyFrom: $('#fBuyFrom').value.trim(),
      origin: $('#fOrigin').value.trim(),
      collection: tokens.collection.get().join(', '),
      tag: tokens.tag.get().join(', '),
      note: $('#fNote').value.trim(),
    };
  }

  $('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saving) return;
    const data = readForm();
    const no = $('#fNo').value.trim();
    const problems = [
      ['#fName', data.name ? '' : 'Anh nhập tên Zippo trước nhé.'],
      ['#fNo', !no || data.no != null ? '' : 'No. chỉ gồm số, để trống thì máy tự đánh số.'],
      ['#fPrice', data.price !== '' && isNaN(data.price) ? 'Giá mua chỉ gồm số (đơn vị nghìn đồng).' : ''],
    ];
    problems.forEach(([sel, msg]) => fieldError(sel, msg));
    const first = problems.find((p) => p[1]);
    if (first) {
      setStatus(first[1], true);
      $(first[0]).focus();
      return;
    }
    const btn = $('#eSave');
    const isNew = !editing;
    let saved = null;
    btn.disabled = true;
    saving = true;
    try {
      setStatus('Đang lưu…');
      if (queued.length) data.photosCount = queued.length;
      saved = (await apiPost({ action: 'save', item: data })).item;
      const total = queued.length;
      for (let i = 1; queued.length; i++) {
        setStatus('Đang tải ảnh ' + i + '/' + total + '…');
        const { data: b64, mime } = await toJpegBase64(queued[0].file);
        const up = await apiPost({ action: 'uploadPhoto', pid: pid(saved), no: pid(saved), data: b64, mime });
        saved.photos = (saved.photos || []).concat(up.photo.id);
        URL.revokeObjectURL(queued.shift().url);
      }
      upsert(saved);
      saving = false;
      editor.close();
      focusCard(state.shown.findIndex((x) => pid(x) === pid(saved)));
      toast(isNew ? 'Đã thêm No. ' + saved.no : 'Đã lưu No. ' + saved.no);
    } catch (err) {
      if (!saved) {
        setStatus('Chưa lưu được: ' + err.message, true);
        return;
      }
      // Thông tin đã vào sheet, chỉ còn ảnh: từ giờ bấm Lưu là sửa chiếc này, không tạo chiếc trùng
      editing = saved;
      upsert(saved);
      $('#eTitle').textContent = 'Sửa Zippo · No. ' + saved.no;
      $('#eSave').textContent = 'Lưu thay đổi';
      $('#fNo').value = saved.no;
      renderPhotos();
      cleanForm = snapshot();
      setStatus('Đã lưu thông tin, còn ' + queued.length + ' ảnh chưa tải lên được: ' + err.message + ' Anh bấm Lưu để thử lại.', true);
    } finally {
      saving = false;
      btn.disabled = false;
    }
  });

  function upsert(item) {
    const i = state.items.findIndex((x) => pid(x) === pid(item));
    if (i >= 0) state.items[i] = item; else state.items.push(item);
    store.del(CACHE_STORE + 'owner');
    renderFilters();
    render();
  }

  async function deleteItem(it) {
    if (!(await ask('Xoá No. ' + it.no + '?', '“' + it.name + '” sẽ bị xoá khỏi sheet Zippo. Ảnh trong thư mục Anh Zippo vẫn được giữ lại.'))) return;
    try {
      await apiPost({ action: 'delete', pid: pid(it), no: pid(it) });
      detail.close();
      state.items = state.items.filter((x) => pid(x) !== pid(it));
      store.del(CACHE_STORE + 'owner');
      renderFilters();
      render();
      toast('Đã xoá No. ' + it.no, 'Hoàn tác', async () => {
        try {
          const res = await apiPost({ action: 'save', item: Object.assign({ photosCount: (it.photos || []).length }, it) });
          upsert(Object.assign(res.item, { photos: it.photos }));
          toast('Đã khôi phục No. ' + it.no);
        } catch (err) { toast('Không khôi phục được: ' + err.message); }
      });
    } catch (err) {
      toast('Không xoá được: ' + err.message);
    }
  }

  $('#addBtn').addEventListener('click', () => openEditor(null));

  // ---------- Hộp xác nhận, thông báo ----------
  function ask(title, text, yes, no) {
    return new Promise((resolve) => {
      const d = $('#confirm');
      if (d.open) { resolve(false); return; }
      $('#cTitle').textContent = title;
      $('#cText').textContent = text;
      $('#cYes').textContent = yes || 'Xoá';
      $('#cNo').textContent = no || 'Huỷ';
      d.returnValue = '';
      d.addEventListener('close', () => resolve(d.returnValue === 'yes'), { once: true });
      d.showModal();
    });
  }

  let toastTimer;
  function toast(msg, action, onAction) {
    const t = $('#toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button">' + esc(action) + '</button>' : '');
    t.hidden = false;
    if (action) t.querySelector('button').onclick = () => { t.hidden = true; onAction(); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, action || msg.length > 80 ? 10000 : 3500);
  }

  // ---------- Thống kê ----------
  function bars(entries, fmt) {
    const max = Math.max(1, ...entries.map((e) => e[1]));
    return '<div class="bars">' + entries.map(([k, v, extra]) => '<div class="bar"><span class="name" title="' + esc(k) + '">' + esc(k) + '</span>' +
      '<span class="track"><span class="fill" style="width:' + (100 * v / max).toFixed(1) + '%"></span></span>' +
      '<span class="val">' + (fmt ? fmt(v) : v) + (extra ? ' <small>' + extra + '</small>' : '') + '</span></div>').join('') + '</div>';
  }
  function panel(title, body, priv) {
    return '<section class="panel"><h2>' + esc(title) + (priv ? ICON.lock : '') + '</h2>' + body + '</section>';
  }
  const short = (k) => (k >= 1000000 ? (k / 1000000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tỷ' : k >= 1000 ? (k / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr' : Math.round(k) + 'k');

  // Biểu đồ cột đứng; data-decade để bấm cột mở bộ sưu tập đã lọc
  function columns(entries, fmt, attr) {
    const max = Math.max(1, ...entries.map((e) => e[1]));
    return '<div class="cols">' + entries.map(([k, v, title, key]) => '<button type="button" class="col"' + (attr && key != null ? ' ' + attr + '="' + esc(key) + '"' : ' tabindex="-1"') +
      ' title="' + esc(title || (k + ': ' + (fmt ? fmt(v) : v))) + '"><span class="col-val">' + (fmt ? fmt(v) : v) + '</span>' +
      '<span class="col-bar" style="height:' + (100 * v / max).toFixed(1) + '%"></span><span class="col-name">' + esc(k) + '</span></button>').join('') + '</div>';
  }

  function renderStats() {
    const items = state.items;
    const byCount = (field) => Array.from(countBy(field)).sort((a, b) => b[1] - a[1]);
    const decades = new Map();
    items.forEach((it) => { const d = decadeOf(it.codeYear); decades.set(d, (decades.get(d) || 0) + 1); });
    const withPhoto = items.filter((it) => it.photos && it.photos.length).length;
    const pct = items.length ? Math.round(100 * withPhoto / items.length) : 0;
    const years = items.map((it) => it.codeYear).filter(Boolean);
    const oldest = years.length ? Math.min(...years) : '—';
    let kpi = '<div class="kpi"><div class="k">Tổng số Zippo</div><div class="v">' + items.length + '</div></div>' +
      '<div class="kpi"><div class="k">Chiếc cũ nhất (Code Year)</div><div class="v">' + oldest + '</div></div>' +
      '<div class="kpi"><div class="k">Đã có ảnh</div><div class="v">' + withPhoto + '</div></div>';
    const decadeRows = Array.from(decades).sort((a, b) => (a[0] === 'none') - (b[0] === 'none') || a[0] - b[0])
      .map(([d, n]) => [decadeLabel(d), n, decadeLabel(d) + ': ' + n + ' chiếc, bấm để xem', String(d)]);
    const ring = '<div class="ring"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5" class="ring-bg"/><circle cx="18" cy="18" r="15.5" class="ring-fg" stroke-dasharray="' + (pct * 0.974).toFixed(1) + ' 100" transform="rotate(-90 18 18)"/></svg>' +
      '<div class="ring-txt"><b>' + pct + '%</b><span>đã có ảnh</span></div></div>' +
      (withPhoto < items.length ? '<button type="button" class="link-btn" id="statsNoPhoto">Xem ' + (items.length - withPhoto) + ' chiếc chưa có ảnh</button>' : '');
    let html = '<section class="panel panel-wide"><h2>Code Year theo thập niên</h2>' + columns(decadeRows, null, 'data-decade') +
      '<p class="note">Bấm vào một cột để mở bộ sưu tập đã lọc theo thập niên đó.</p></section>' +
      panel('Tiến độ chụp ảnh', ring) +
      panel('Theo Case', bars(byCount('caseType'))) +
      panel('Finish phổ biến', bars(byCount('finish').slice(0, 12)));
    if (state.owner) {
      const total = items.reduce((s, it) => s + (it.price || 0), 0);
      const thisYear = new Date().getFullYear();
      kpi += '<div class="kpi"><div class="k">' + ICON.lock + 'Mua năm ' + thisYear + '</div><div class="v">' + items.filter((it) => it.yearPurchase === thisYear).length + '</div></div>' +
        '<div class="kpi kpi-private"><div class="k">' + ICON.lock + 'Tổng giá trị</div><div class="v">' + short(total) + '</div></div>';
      const ym = new Map();
      items.forEach((it) => {
        if (!it.yearPurchase) return;
        const e = ym.get(it.yearPurchase) || [0, 0];
        e[0] += 1; e[1] += it.price || 0;
        ym.set(it.yearPurchase, e);
      });
      const ys = Array.from(ym).sort((a, b) => a[0] - b[0]);
      html += '<section class="panel panel-wide panel-private"><h2>' + 'Chi tiêu theo năm' + ICON.lock + '</h2>' +
        columns(ys.map(([y, e]) => ["'" + String(y).slice(2), e[1], y + ': ' + e[0] + ' chiếc, ' + money(e[1])]), short) +
        '<p class="note">Di chuột hoặc chạm giữ vào cột để xem số chiếc và tổng tiền năm đó.</p></section>' +
        panel('Số chiếc mua theo năm', bars(ys.map(([y, e]) => [String(y), e[0]])), true) +
        panel('Mua tại', bars(byCount('buyFrom')), true) +
        panel('Xuất xứ', bars(byCount('origin')), true) +
        panel('Thư mục ảnh', '<p class="note">Mỗi Zippo một thư mục “No. - Tên - ID” trong Anh Zippo. Máy tự đồng bộ mỗi giờ; bấm nút dưới đây nếu anh vừa sửa tên hoặc đánh lại No. trong sheet và muốn đồng bộ ngay.</p>' +
          '<button type="button" class="btn btn-dark" id="syncFolders">Đồng bộ thư mục ảnh</button>', true);
    }
    $('#statsView').innerHTML = '<h1>Thống kê</h1><div class="kpis">' + kpi + '</div><div class="panels">' + html + '</div>';
    $$('#statsView [data-decade]').forEach((c) => c.addEventListener('click', () => {
      clearFilters();
      const d = c.dataset.decade;
      state.items.forEach((it) => { if (String(decadeOf(it.codeYear)) === d) state.filters.codeYear.add(String(it.codeYear || 'none')); });
      renderFilters();
      go('collection');
      render();
    }));
    const np = $('#statsNoPhoto');
    if (np) np.addEventListener('click', () => { clearFilters(); state.noPhoto = true; go('collection'); render(); });
    const sync = $('#syncFolders');
    if (sync) sync.addEventListener('click', async () => {
      sync.disabled = true;
      sync.textContent = 'Đang đồng bộ… (có thể mất vài phút)';
      try {
        const res = await apiPost({ action: 'syncFolders' });
        toast(res.result.message);
        load();
      } catch (err) {
        toast('Chưa đồng bộ được: ' + err.message);
      } finally {
        sync.disabled = false;
        sync.textContent = 'Đồng bộ thư mục ảnh';
      }
    });
  }

  // ---------- Điều hướng ----------
  function go(page) {
    state.page = page;
    $('#collectionView').hidden = page !== 'collection';
    $('#statsView').hidden = page !== 'stats';
    $$('[data-nav]').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === page));
    $$('.tab, .bottom-nav button').forEach((b) => {
      if (b.dataset.nav === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (page === 'stats') renderStats();
    window.scrollTo(0, 0);
  }
  $$('[data-nav]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); go(b.dataset.nav); }));
  $('#q').addEventListener('focus', () => { if (state.page !== 'collection') go('collection'); });
  $('.skip-link').addEventListener('click', (e) => {
    e.preventDefault();
    $(state.page === 'stats' ? '#statsView' : '#main').focus();
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderSortOptions();
  load();
})();
