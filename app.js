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
    lighter: '<svg class="ph" viewBox="0 0 54 84" aria-hidden="true"><rect x="3" y="26" width="48" height="55" rx="5"/><path d="M3 34h48"/><rect x="10" y="3" width="34" height="23" rx="3"/><circle cx="20" cy="10" r="1.5"/><circle cx="27" cy="10" r="1.5"/><circle cx="34" cy="10" r="1.5"/><circle cx="20" cy="18" r="1.5"/><circle cx="27" cy="18" r="1.5"/><circle cx="34" cy="18" r="1.5"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  };

  const state = {
    items: [],
    lists: { cases: [], finishes: [], conditions: [] },
    owner: false,
    key: store.get(KEY_STORE) || '',
    q: '',
    filters: { collection: new Set(), caseType: new Set(), finish: new Set(), codeYear: new Set(), yearPurchase: new Set() },
    open: new Set(['caseType']),
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
  async function apiGet() {
    const res = await fetch(API + '?t=' + Date.now(), { redirect: 'follow' });
    return check(await res.json());
  }
  async function apiPost(body) {
    const res = await fetch(API, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ key: state.key }, body)),
    });
    return check(await res.json());
  }
  function check(data) {
    if (!data || !data.ok) throw new Error((data && data.error) || 'Máy chủ không trả lời.');
    return data;
  }

  async function load() {
    const cacheKey = CACHE_STORE + (state.key ? 'owner' : 'guest');
    const cached = store.get(cacheKey);
    if (cached) {
      try { applyData(JSON.parse(cached)); } catch (e) { /* bỏ qua */ }
    } else {
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
      toast(cached ? 'Đang xem bản lưu trên máy (không tải được dữ liệu mới).' : 'Không tải được dữ liệu: ' + err.message);
      if (!cached) $('#summary').textContent = 'Không tải được dữ liệu.';
    }
  }

  // Đọc tên ảnh trong thư mục Anh Zippo: 12.jpg là ảnh chính, 12_2.jpg, 12_3.jpg… là ảnh phụ
  // (vẫn nhận thêm "12 (1).jpg", "12-2.jpg").
  const PHOTO_NAME = /^(\d+)\s*(?:[_\-\s]\s*(\d+)|\(\s*(\d+)\s*\))?\s*\.(jpe?g|png|webp|heic|gif)$/i;
  function attachPhotos(items, files) {
    const map = {};
    files.forEach((f) => {
      const m = String(f.n).trim().match(PHOTO_NAME);
      if (!m) return;
      const idx = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : 0;
      (map[Number(m[1])] = map[Number(m[1])] || []).push([idx, f.id]);
    });
    items.forEach((it) => { it.photos = (map[it.no] || []).sort((a, b) => a[0] - b[0]).map((e) => e[1]); });
  }

  // Phải khớp API_VERSION trong apps-script/Code.gs
  const API_VERSION = 3;

  function applyData(data, fresh) {
    if (fresh && data.owner) {
      if ((data.version || 0) < API_VERSION) {
        toast('Apps Script trên Google chưa phải bản mới nhất (đang chạy bản ' + (data.version || 1) + ', cần bản ' + API_VERSION + '). Anh làm lại bước cập nhật Apps Script nhé.');
      }
    }
    state.items = data.items || [];
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
    state.items.forEach((it) => {
      const v = it[field];
      if (v === '' || v == null) return;
      m.set(v, (m.get(v) || 0) + 1);
    });
    return m;
  }

  function optHtml(group, value, label, count, checked) {
    return '<label class="opt"><input type="checkbox" data-group="' + group + '" value="' + esc(value) + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="label">' + esc(label) + '</span><span class="count">' + count + '</span></label>';
  }

  function groupHtml(key, title, body, priv) {
    const open = state.open.has(key);
    const n = state.filters[key].size;
    return '<div class="fgroup">' +
      '<button type="button" class="fgroup-head" data-toggle="' + key + '" aria-expanded="' + open + '">' +
      '<span>' + esc(title) + '</span>' + (priv ? ICON.lock : '') +
      (n ? '<span class="badge">' + n + '</span>' : '') + (open ? ICON.up : ICON.down) + '</button>' +
      (open ? '<div class="fgroup-body">' + body + '</div>' : '') + '</div>';
  }

  function renderFilters() {
    const f = state.filters;
    const html = [];

    // Nhóm lọc theo giá trị thật trong sheet, nhiều nhất lên đầu; dài quá thì hiện 10–12 mục + "Xem thêm"
    const limit = window.matchMedia('(max-width: 799px)').matches ? 12 : 10;
    const valueGroup = (key, title) => {
      const all = Array.from(countBy(key)).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
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
    valueGroup('caseType', 'Case');
    valueGroup('finish', 'Finish');

    // Code Year: nhóm theo thập niên, mở ra từng năm
    const years = new Map();
    state.items.forEach((it) => {
      const d = decadeOf(it.codeYear);
      if (!years.has(d)) years.set(d, new Map());
      const y = it.codeYear || 'none';
      years.get(d).set(y, (years.get(d).get(y) || 0) + 1);
    });
    const decades = Array.from(years.keys()).sort((a, b) => (a === 'none') - (b === 'none') || a - b);
    const cyBody = decades.map((d) => {
      const ys = Array.from(years.get(d)).sort((a, b) => a[0] - b[0]);
      const total = ys.reduce((s, e) => s + e[1], 0);
      const allOn = ys.every(([y]) => f.codeYear.has(String(y)));
      const someOn = ys.some(([y]) => f.codeYear.has(String(y)));
      const open = state.decadesOpen.has(String(d));
      let out = '<div class="decade"><div class="decade-row">' +
        '<label class="opt"><input type="checkbox" data-decade="' + d + '"' + (allOn ? ' checked' : '') + (someOn && !allOn ? ' data-partial' : '') + '>' +
        '<span class="label">' + decadeLabel(d) + '</span><span class="count">' + total + '</span></label>';
      if (d !== 'none') {
        out += '<button type="button" class="decade-toggle" data-decade-open="' + d + '" aria-expanded="' + open + '" aria-label="Xem từng năm ' + decadeLabel(d) + '">' + (open ? ICON.up : ICON.down) + '</button>';
      }
      out += '</div>';
      if (open) {
        out += '<div class="decade-years">' + ys.map(([y, n]) => '<button type="button" class="chip' + (f.codeYear.has(String(y)) ? ' is-on' : '') + '" data-year="' + y + '" aria-pressed="' + f.codeYear.has(String(y)) + '">' + y + ' <span class="count">' + n + '</span></button>').join('') + '</div>';
      }
      return out + '</div>';
    }).join('');
    html.push(groupHtml('codeYear', 'Code Year', cyBody));

    if (state.owner) {
      const yp = Array.from(countBy('yearPurchase')).sort((a, b) => a[0] - b[0]);
      html.push(groupHtml('yearPurchase', 'Năm mua', yp.map(([v, n]) => optHtml('yearPurchase', v, v, n, f.yearPurchase.has(String(v)))).join(''), true));
    }

    $('#filterGroups').innerHTML = html.join('');
    $$('#filterGroups input[data-partial]').forEach((el) => { el.indeterminate = true; });
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
      state.open.has(k) ? state.open.delete(k) : state.open.add(k);
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
    Object.values(state.filters).forEach((s) => s.clear());
    renderFilters();
    render();
  }
  $('#clearFilters').addEventListener('click', clearFilters);
  $('#sheetClear').addEventListener('click', clearFilters);

  // Tấm lọc trên điện thoại
  function openSheet(open) {
    $('#filters').classList.toggle('is-open', open);
    $('#filtersBackdrop').hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
  }
  $('#openFilters').addEventListener('click', () => openSheet(true));
  $('#closeFilters').addEventListener('click', () => openSheet(false));
  $('#sheetApply').addEventListener('click', () => openSheet(false));
  $('#filtersBackdrop').addEventListener('click', () => openSheet(false));

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

  function matches(it) {
    const f = state.filters;
    if (f.collection.size && !f.collection.has(it.collection)) return false;
    if (f.caseType.size && !f.caseType.has(it.caseType)) return false;
    if (f.finish.size && !f.finish.has(it.finish)) return false;
    if (f.codeYear.size && !f.codeYear.has(String(it.codeYear || 'none'))) return false;
    if (f.yearPurchase.size && !f.yearPurchase.has(String(it.yearPurchase))) return false;
    if (state.q) {
      const hay = [it.no, it.name, it.sku, it.collection, it.caseType, it.finish, it.code, it.codeYear, it.note, it.buyFrom, it.origin].join(' ').toLowerCase();
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

  function cardHtml(it, i) {
    const photo = it.photos && it.photos[0];
    const meta = [it.caseType, it.finish].filter(Boolean).join(' · ');
    return '<button type="button" class="card" data-i="' + i + '" aria-label="Xem chi tiết ' + esc(it.name) + '">' +
      '<div class="card-img">' + (photo ? '<img loading="lazy" decoding="async" src="' + img(photo, 600) + '" alt="">' : ICON.lighter) +
      '<span class="no-badge">#' + it.no + '</span>' + (it.photos && it.photos.length > 1 ? '<span class="pcount">' + it.photos.length + ' ảnh</span>' : '') + '</div>' +
      '<div class="card-body"><h3>' + esc(it.name) + '</h3><p class="meta">' + esc(meta || '—') + '</p>' +
      '<div class="foot"><span class="code">' + esc(it.code || '—') + '</span>' + (state.owner && it.price ? '<span class="price">' + money(it.price) + '</span>' : '') + '</div></div></button>';
  }

  function render() {
    state.shown = state.items.filter(matches).sort(sorter());
    const grid = $('#grid');
    grid.classList.toggle('is-list', state.view === 'list');
    grid.innerHTML = state.shown.map(cardHtml).join('');
    $('#empty').hidden = state.shown.length > 0 || !state.items.length;
    const parts = [];
    const f = state.filters;
    if (f.collection.size) parts.push(Array.from(f.collection).join(', '));
    if (f.caseType.size) parts.push('Case: ' + Array.from(f.caseType).join(', '));
    if (f.finish.size) parts.push(Array.from(f.finish).join(', '));
    $('#summary').innerHTML = '<strong>' + state.shown.length + '</strong> / ' + state.items.length + ' chiếc' + (parts.length ? ' · ' + esc(parts.join(' · ')) : '');
    renderActiveChips();
    $$('.view-switch .icon-btn').forEach((b) => {
      const on = b.dataset.view === state.view;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on);
    });
    if (state.page === 'stats') renderStats();
  }

  function renderActiveChips() {
    const out = [];
    const names = { collection: '', caseType: '', finish: '', codeYear: 'Code ', yearPurchase: 'Mua ' };
    Object.keys(state.filters).forEach((g) => state.filters[g].forEach((v) => {
      out.push('<button type="button" class="chip is-on" data-chip-group="' + g + '" data-chip-value="' + esc(v) + '" aria-label="Bỏ lọc ' + esc(v) + '">' +
        esc(names[g] + (v === 'none' ? 'không rõ' : v)) + ' <span aria-hidden="true">×</span></button>');
    }));
    if (state.q) out.push('<button type="button" class="chip is-on" data-chip-q aria-label="Bỏ tìm kiếm">“' + esc(state.q) + '” <span aria-hidden="true">×</span></button>');
    $('#activeChips').innerHTML = out.join('');
  }
  $('#activeChips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    if (c.hasAttribute('data-chip-q')) { state.q = ''; $('#q').value = ''; }
    else state.filters[c.dataset.chipGroup].delete(c.dataset.chipValue);
    renderFilters();
    render();
  });

  function renderSkeleton() {
    $('#grid').innerHTML = Array.from({ length: 10 }, () => '<div class="skeleton"></div>').join('');
  }

  let qTimer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = e.target.value.trim(); render(); }, 150);
  });
  $$('.view-switch .icon-btn').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; savePrefs(); render(); }));
  $('#grid').addEventListener('click', (e) => {
    const c = e.target.closest('.card');
    if (c) openDetail(Number(c.dataset.i));
  });

  // ---------- Chi tiết ----------
  const detail = $('#detail');

  function openDetail(i) {
    if (i < 0 || i >= state.shown.length) return;
    state.detailIndex = i;
    state.photoIndex = 0;
    fillDetail();
    if (!detail.open) detail.showModal();
    history.replaceState(null, '', '#no=' + state.shown[i].no);
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
      ['Code', it.code || '—', 'code'], ['Code Year', it.codeYear || ''], ['Case', it.caseType], ['Finish', it.finish], ['Collection', it.collection], ['SKU', it.sku],
    ]);
    if (state.owner) {
      $('#dPrivate').innerHTML = '<h3>' + ICON.lock + 'Riêng tư</h3><dl class="facts">' + factRows([
        ['Giá mua', money(it.price)], ['Ngày mua', dateVN(it.date) || (it.yearPurchase || '')], ['Tình trạng vỏ', it.caseCond],
        ['Tình trạng ruột', it.insertsCond], ['Mua tại', it.buyFrom], ['Xuất xứ', it.origin],
      ]) + '</dl>' + (it.note ? '<p class="note">' + esc(it.note) + '</p>' : '');
    }
    fillDetailPhoto();
    $('#dPrev').disabled = state.detailIndex === 0;
    $('#dNext').disabled = state.detailIndex === state.shown.length - 1;
  }

  function fillDetailPhoto() {
    const it = state.shown[state.detailIndex];
    const photos = it.photos || [];
    const id = photos[state.photoIndex];
    $('#dImg').innerHTML = id ? '<img src="' + img(id, 1600) + '" alt="' + esc(it.name) + '">' : ICON.lighter;
    $('#dThumbs').innerHTML = photos.length > 1 ? photos.map((p, i) => '<button type="button" class="' + (i === state.photoIndex ? 'is-on' : '') + '" data-p="' + i + '" aria-label="Ảnh ' + (i + 1) + '"><img loading="lazy" src="' + img(p, 200) + '" alt=""></button>').join('') : '';
  }

  $('#dThumbs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { state.photoIndex = Number(b.dataset.p); fillDetailPhoto(); }
  });
  $('#dPrev').addEventListener('click', () => openDetail(state.detailIndex - 1));
  $('#dNext').addEventListener('click', () => openDetail(state.detailIndex + 1));
  detail.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') openDetail(state.detailIndex - 1);
    if (e.key === 'ArrowRight') openDetail(state.detailIndex + 1);
  });
  detail.addEventListener('close', () => history.replaceState(null, '', location.pathname + location.search));
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
    const m = location.hash.match(/no=(\d+)/);
    if (!m || detail.open) return;
    const i = state.shown.findIndex((it) => it.no === Number(m[1]));
    if (i >= 0) openDetail(i);
  }

  // Đóng hộp thoại khi bấm nút có data-close hoặc bấm ra ngoài
  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || e.target === d) d.close();
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

  function fillSelect(sel, options, value, withOther) {
    const opts = options.slice();
    const known = !value || opts.includes(value);
    let html = '<option value="">—</option>' + opts.map((o) => '<option' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>').join('');
    if (withOther) html += '<option value="__other"' + (!known ? ' selected' : '') + '>Khác (tự nhập)…</option>';
    else if (!known) html += '<option selected>' + esc(value) + '</option>';
    sel.innerHTML = html;
    return known;
  }

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
    $('#fNo').value = it ? it.no : 'Tự động: ' + (state.items.reduce((m, x) => Math.max(m, x.no), 0) + 1);
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
    $('#fCollection').value = v.collection || '';
    $('#fNote').value = v.note || '';
    $('#dlBuyFrom').innerHTML = uniq('buyFrom').map((o) => '<option value="' + esc(o) + '">').join('');
    $('#dlOrigin').innerHTML = uniq('origin').map((o) => '<option value="' + esc(o) + '">').join('');
    $('#dlCollection').innerHTML = uniq('collection').map((o) => '<option value="' + esc(o) + '">').join('');
    $('#fName').closest('.field').classList.remove('invalid');
    $('#eStatus').textContent = 'Lưu xong, dữ liệu được ghi thẳng vào sheet Zippo trên Google Drive của anh.';
    updateCodeYear();
    renderPhotos();
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
    const no = editing ? editing.no : 'No.';
    $('#dropHint').textContent = 'Ảnh được lưu vào thư mục Anh Zippo với tên ' + no + '.jpg, ' + no + '_2.jpg… khi bấm Lưu.';
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
    const no = editing.no;
    try {
      b.disabled = true;
      let res;
      if (b.dataset.del) {
        if (!(await ask('Xoá ảnh này?', 'Ảnh sẽ được chuyển vào Thùng rác của Google Drive (khôi phục được trong 30 ngày).'))) { b.disabled = false; return; }
        res = await apiPost({ action: 'deletePhoto', no, id: b.dataset.del });
      } else if (b.dataset.main) {
        res = await apiPost({ action: 'setMainPhoto', no, id: b.dataset.main });
      }
      editing.photos = res.photos;
      const item = state.items.find((x) => x.no === no);
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
    return {
      no: editing ? editing.no : undefined,
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
      collection: $('#fCollection').value.trim(),
      note: $('#fNote').value.trim(),
    };
  }

  $('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readForm();
    if (!data.name) {
      $('#fName').closest('.field').classList.add('invalid');
      $('#fName').focus();
      $('#eStatus').textContent = 'Anh nhập tên Zippo trước nhé.';
      return;
    }
    if (data.price !== '' && isNaN(data.price)) {
      $('#fPrice').focus();
      $('#eStatus').textContent = 'Giá mua chỉ gồm số (đơn vị nghìn đồng).';
      return;
    }
    const btn = $('#eSave');
    btn.disabled = true;
    try {
      $('#eStatus').textContent = 'Đang lưu…';
      if (queued.length) data.photosCount = queued.length;
      const res = await apiPost({ action: 'save', item: data });
      const saved = res.item;
      for (let i = 0; i < queued.length; i++) {
        $('#eStatus').textContent = 'Đang tải ảnh ' + (i + 1) + '/' + queued.length + '…';
        const { data: b64, mime } = await toJpegBase64(queued[i].file);
        const up = await apiPost({ action: 'uploadPhoto', no: saved.no, data: b64, mime });
        saved.photos = (saved.photos || []).concat(up.photo.id);
      }
      upsert(saved);
      editor.close();
      toast(editing ? 'Đã lưu No. ' + saved.no : 'Đã thêm No. ' + saved.no);
    } catch (err) {
      $('#eStatus').textContent = 'Chưa lưu được: ' + err.message;
    } finally {
      btn.disabled = false;
    }
  });

  function upsert(item) {
    const i = state.items.findIndex((x) => x.no === item.no);
    if (i >= 0) state.items[i] = item; else state.items.push(item);
    store.del(CACHE_STORE + 'owner');
    renderFilters();
    render();
  }

  async function deleteItem(it) {
    if (!(await ask('Xoá No. ' + it.no + '?', '“' + it.name + '” sẽ bị xoá khỏi sheet Zippo. Ảnh trong thư mục Anh Zippo vẫn được giữ lại.'))) return;
    try {
      await apiPost({ action: 'delete', no: it.no });
      detail.close();
      state.items = state.items.filter((x) => x.no !== it.no);
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
  function ask(title, text) {
    return new Promise((resolve) => {
      const d = $('#confirm');
      $('#cTitle').textContent = title;
      $('#cText').textContent = text;
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

  function renderStats() {
    const items = state.items;
    const byCount = (field) => Array.from(countBy(field)).sort((a, b) => b[1] - a[1]);
    const decades = new Map();
    items.forEach((it) => { const d = decadeLabel(decadeOf(it.codeYear)); decades.set(d, (decades.get(d) || 0) + 1); });
    const withPhoto = items.filter((it) => it.photos && it.photos.length).length;
    let kpi = '<div class="kpi"><div class="k">Tổng số Zippo</div><div class="v">' + items.length + '</div></div>' +
      '<div class="kpi"><div class="k">Số loại Case</div><div class="v">' + countBy('caseType').size + '</div></div>' +
      '<div class="kpi"><div class="k">Đã có ảnh</div><div class="v">' + withPhoto + '</div></div>';
    let html = panel('Theo Case', bars(byCount('caseType'))) +
      panel('Finish phổ biến', bars(byCount('finish').slice(0, 12))) +
      panel('Code Year theo thập niên', bars(Array.from(decades).sort((a, b) => (a[0] === 'Không rõ') - (b[0] === 'Không rõ') || a[0].localeCompare(b[0]))));
    if (state.owner) {
      const total = items.reduce((s, it) => s + (it.price || 0), 0);
      kpi += '<div class="kpi"><div class="k">' + ICON.lock + 'Tổng giá trị</div><div class="v">' + short(total) + '</div></div>';
      const years = new Map();
      items.forEach((it) => {
        if (!it.yearPurchase) return;
        const e = years.get(it.yearPurchase) || [0, 0];
        e[0] += 1; e[1] += it.price || 0;
        years.set(it.yearPurchase, e);
      });
      const ys = Array.from(years).sort((a, b) => a[0] - b[0]);
      html += panel('Số chiếc mua theo năm', bars(ys.map(([y, e]) => [String(y), e[0]])), true) +
        panel('Chi tiêu theo năm', bars(ys.map(([y, e]) => [String(y), e[1]]), short), true) +
        panel('Mua tại', bars(byCount('buyFrom')), true) +
        panel('Xuất xứ', bars(byCount('origin')), true);
    }
    $('#statsView').innerHTML = '<h1>Thống kê</h1><div class="kpis">' + kpi + '</div><div class="panels">' + html + '</div>';
  }

  // ---------- Điều hướng ----------
  function go(page) {
    state.page = page;
    $('#collectionView').hidden = page !== 'collection';
    $('#statsView').hidden = page !== 'stats';
    $$('[data-nav]').forEach((b) => b.classList.toggle('is-active', b.dataset.nav === page));
    if (page === 'stats') renderStats();
    window.scrollTo(0, 0);
  }
  $$('[data-nav]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); go(b.dataset.nav); }));
  $('#q').addEventListener('focus', () => { if (state.page !== 'collection') go('collection'); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderSortOptions();
  load();
})();
