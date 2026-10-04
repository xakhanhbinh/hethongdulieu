// Các hàm dùng chung cho bảng dữ liệu của 17 ngành.
const tableState = { rows: [], page: 1, size: 50 };
let searchTimer;

function renderTable(rows) {
  tableState.rows = Array.isArray(rows) ? rows : [];
  tableState.page = 1;
  drawTablePage();
}

function drawTablePage() {
  const { rows, size } = tableState;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  tableState.page = Math.min(pages, Math.max(1, tableState.page));
  const start = (tableState.page - 1) * size;
  renderRows(rows.slice(start, start + size));
  let pager = document.getElementById('dataPager');
  if (!pager) {
    pager = document.createElement('div');
    pager.id = 'dataPager';
    pager.className = 'data-pager';
    document.getElementById('tableBody').closest('table').parentElement.after(pager);
  }
  pager.hidden = false;
  pager.replaceChildren();
  const info = document.createElement('span');
  info.textContent = rows.length ? `${start + 1}–${Math.min(start + size, rows.length)} / ${rows.length} dòng` : '0 dòng';
  pager.append(info);
  const select = document.createElement('select');
  select.className = 'form-select form-select-sm';
  select.setAttribute('aria-label', 'Số dòng mỗi trang');
  for (const sizeOption of [25, 50, 100]) {
    const option = new Option(`${sizeOption} dòng`, sizeOption);
    option.selected = sizeOption === size;
    select.append(option);
  }
  select.onchange = () => { tableState.size = Number(select.value); tableState.page = 1; drawTablePage(); };
  pager.append(select);
  for (const [label, step, disabled] of [['Trước', -1, tableState.page === 1], ['Sau', 1, tableState.page === pages]]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm btn-outline-secondary';
    button.textContent = label;
    button.disabled = disabled;
    button.onclick = () => { tableState.page += step; drawTablePage(); };
    pager.append(button);
  }
  const page = document.createElement('span');
  page.textContent = `Trang ${tableState.page}/${pages}`;
  pager.append(page);
}

function filterData() {
  const keyword = document.getElementById('searchInput').value.trim().toLocaleLowerCase('vi');
  const rows = keyword ? globalData.filter(row => Object.values(row).some(value =>
    String(value ?? '').toLocaleLowerCase('vi').includes(keyword))) : globalData;
  renderTable(rows);
}

function scheduleFilter() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(filterData, 150);
}

// Chia sẻ một yêu cầu đang chạy; mỗi người dùng nhận bản sao phản hồi.
const pendingReads = new Map();
function fastRead(url, options) {
  if (options?.method && options.method.toUpperCase() !== 'GET') return fetch(url, options);
  const key = String(url);
  if (!pendingReads.has(key)) {
    const request = fetch(url, options);
    pendingReads.set(key, request);
    request.then(() => pendingReads.delete(key), () => pendingReads.delete(key));
  }
  return pendingReads.get(key).then(response => response.clone());
}


function escapeLabel(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}


// Giữ nguyên thứ tự cột; tách khung khi đường dẫn nhóm thay đổi.
function buildModalGroups(fields) {
  const groups = [];
  for (const field of fields) {
    const path = Array.isArray(field.headerPath) ? field.headerPath : String(field.fullLabel || field.label || '').split(' / ');
    const parents = path.length > 1 ? path.slice(0, -1) : [];
    const name = parents.length ? parents.join(' / ') : 'Thông tin chung';
    let group = groups[groups.length - 1];
    if (!group || group.name !== name) {
      group = {name, fields:[]};
      groups.push(group);
    }
    group.fields.push(field);
  }
  return groups;
}

function generateTableHeaderAndForm() {
  const header = document.getElementById('tableHeaderBlock');
  const form = document.getElementById('formFields');
  if (!sheetSchema) {
    header.replaceChildren();
    header.hidden = true;
    form.replaceChildren();
    return;
  }
  const rows = sheetSchema.headerRows;
  header.innerHTML = rows.map((row,index) => '<tr>' +
    (index === 0 ? `<th rowspan="${rows.length}">Thao tác</th>` : '') +
    row.map(cell => `<th rowspan="${cell.rowSpan}" colspan="${cell.colSpan}">${escapeLabel(cell.label)}</th>`).join('') + '</tr>').join('');
  form.innerHTML = buildModalGroups(sheetSchema.fields).map((group, index) =>
    `<fieldset class="entry-group"><legend><span class="entry-group-number">${index+1}</span>${escapeLabel(group.name)}</legend>` +
    `<div class="row g-3">` + group.fields.map(field =>
      `<div class="col-12 col-md-6 col-xl-4"><label class="form-label" for="${escapeLabel(field.id)}">${escapeLabel(field.fullLabel || field.label)}</label>` +
      `<input class="form-control form-control-sm" type="text" id="${escapeLabel(field.id)}" ${field.readonly ? 'readonly aria-readonly="true"' : ''}></div>`).join('') +
    '</div></fieldset>').join('');
  form.classList.remove('row');
}

async function readSheetJson(url) {
  const response = await fastRead(url);
  if (!response.ok) throw new Error('API dữ liệu trả HTTP ' + response.status);
  let value;
  try { value = JSON.parse(await response.text()); }
  catch (_) { throw new Error('API chưa trả JSON. Cập nhật triển khai GS của ngành này.'); }
  if (value?.status === 'error' || value?.success === false) throw new Error(value.message || 'Không đọc được Sheet.');
  return value;
}

let pageLoadPromise = null;
async function loadSheetData() {
  if (!ubktAccessGranted) return;
  if (pageLoadPromise) return pageLoadPromise;
  pageLoadPromise = (async () => {
    const tbody = document.getElementById('tableBody');
    document.getElementById('tableHeaderBlock').hidden = true;
    const loadingPager = document.getElementById('dataPager');
    if (loadingPager) loadingPager.hidden = true;
    tbody.innerHTML = '<tr><td class="data-loading" role="status" aria-live="polite">Đang tải dữ liệu</td></tr>';
    try {
      if (!WEB_APP_URL) throw new Error('Chưa có WEB_APP_URL của ngành này.');
      const schemaTask = readSheetJson(WEB_APP_URL+'?action=getSchema').then(schema => {
        if (!Array.isArray(schema.headerRows) || !schema.headerRows.length || !Array.isArray(schema.fields) || schema.fields.length !== schema.columnCount) {
          throw new Error('Cần triển khai GS mới đi kèm bộ HTML này để đọc đầy đủ tiêu đề.');
        }
        sheetSchema = schema;
        if (typeof columnCount !== "undefined") columnCount = schema.columnCount;
        fieldGroups = schema.groups;
        schemaLoaded = true;
        generateTableHeaderAndForm();
        return schema;
      });
      const [, rows] = await Promise.all([schemaTask,readSheetJson(WEB_APP_URL+'?action=getData')]);
      if (!Array.isArray(rows)) throw new Error('Dữ liệu trả về không phải danh sách.');
      globalData = rows;
      document.getElementById('tableHeaderBlock').hidden = false;
      filterData();
    } catch (error) {
      document.getElementById('tableHeaderBlock').hidden = !sheetSchema;
      tbody.replaceChildren();
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = sheetSchema ? sheetSchema.columnCount+1 : 1;
      cell.className = 'text-center text-danger py-4';
      cell.textContent = error.message;
      row.append(cell);tbody.append(row);
      const pager = document.getElementById('dataPager');
      if (pager) pager.replaceChildren();
      showToast(error.message, 'error');
    }
  })();
  try { await pageLoadPromise; } finally { pageLoadPromise = null; }
}
