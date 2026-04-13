// ============================================================
//  GoTech CRM — Google Apps Script Backend
//  Paste this entire file into your Apps Script editor,
//  then Deploy → New Deployment → Web App
//  (Execute as: Me | Who has access: Anyone)
// ============================================================

// ── Sheet names (create these tabs in your Google Sheet) ────
const SHEET_PRODUCTS = 'Products';
const SHEET_SALES    = 'Sales';
const SHEET_LOG      = 'ActivityLog';   // optional audit trail

// ── CORS headers helper ──────────────────────────────────────
function corsResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  GET  — called by inventory.html to read products
//  URL: ?action=getProducts   (or just bare GET → same result)
// ============================================================
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'getProducts';

  if (action === 'getProducts') {
    return getProducts();
  }
  if (action === 'getSales') {
    return getSales_();
  }

  return corsResponse({ success: false, error: 'Unknown action: ' + action });
}

// ============================================================
//  POST  — called for write operations (register / edit /
//          delete / sell).  mode:no-cors sends text/plain so
//          we parse the body as raw JSON string.
// ============================================================
function doPost(e) {
  let payload;
  try {
    // Apps Script receives the body in e.postData.contents
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return corsResponse({ success: false, error: 'Invalid JSON: ' + err.message });
  }

  const action = payload.action || '';

  switch (action) {
    case 'registerProduct': return registerProduct(payload);
    case 'editProduct':     return editProduct(payload);
    case 'deleteProduct':   return deleteProduct(payload);
    case 'recordSale':      return recordSale(payload);
    default:
      return corsResponse({ success: false, error: 'Unknown action: ' + action });
  }
}

// ============================================================
//  Helper: get or create a sheet by name
// ============================================================
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    initSheet(sheet, name);
  }
  return sheet;
}

// ── Create header rows the first time ───────────────────────
function initSheet(sheet, name) {
  if (name === SHEET_PRODUCTS) {
    sheet.appendRow(['id', 'name', 'quantity', 'price_tzs_', 'registered_at', 'updated_at']);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#0b63ce').setFontColor('white');
  } else if (name === SHEET_SALES) {
    sheet.appendRow(['id', 'product_id', 'product_name', 'quantity', 'cost_price', 'sell_price', 'revenue', 'profit', 'seller', 'customer', 'datetime']);
    sheet.getRange(1, 1, 1, 11).setFontWeight('bold').setBackground('#00b09b').setFontColor('white');
  } else if (name === SHEET_LOG) {
    sheet.appendRow(['timestamp', 'action', 'details']);
    sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#555').setFontColor('white');
  }
}

// ── Audit log helper ─────────────────────────────────────────
function logActivity(action, details) {
  try {
    const sheet = getSheet(SHEET_LOG);
    sheet.appendRow([new Date().toISOString(), action, JSON.stringify(details)]);
  } catch(e) { /* non-critical — silently ignore */ }
}

// ============================================================
//  READ products  (returns JSON array)
// ============================================================
function getProducts() {
  const sheet = getSheet(SHEET_PRODUCTS);
  const data  = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return corsResponse({ success: true, data: [] });
  }

  const headers = data[0].map(h => String(h).toLowerCase().trim());
  const rows = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).filter(r => r['name']); // skip blank rows

  return corsResponse({ success: true, data: rows });
}

// ============================================================
//  READ sales  (returns JSON array)
// ============================================================
function getSales_() {
  const sheet = getSheet(SHEET_SALES);
  const data  = sheet.getDataRange().getValues();

  if (data.length <= 1) {
    return corsResponse({ success: true, data: [] });
  }

  const headers = data[0].map(h => String(h).toLowerCase().trim());
  const rows = data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });

  return corsResponse({ success: true, data: rows });
}

// ============================================================
//  REGISTER / UPDATE a product
//  If a product with the same name exists → add to quantity.
//  Otherwise → insert new row.
// ============================================================
function registerProduct(p) {
  const sheet = getSheet(SHEET_PRODUCTS);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).toLowerCase().trim());

  const nameCol = headers.indexOf('name');
  const qtyCol  = headers.indexOf('quantity');
  const priceCol= headers.indexOf('price_tzs_');
  const updCol  = headers.indexOf('updated_at');

  // Check if product already exists (case-insensitive)
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][nameCol]).toLowerCase() === String(p.name).toLowerCase()) {
      // Update: add quantity, overwrite price
      const newQty = Number(data[i][qtyCol]) + Number(p.quantity);
      sheet.getRange(i + 1, qtyCol + 1).setValue(newQty);
      sheet.getRange(i + 1, priceCol + 1).setValue(Number(p.price));
      sheet.getRange(i + 1, updCol + 1).setValue(new Date().toISOString());
      logActivity('registerProduct_update', { name: p.name, addedQty: p.quantity, newQty, price: p.price });
      return corsResponse({ success: true, message: 'Product quantity updated', id: data[i][headers.indexOf('id')] });
    }
  }

  // Insert new product
  const id = Date.now();
  sheet.appendRow([
    id,
    p.name,
    Number(p.quantity),
    Number(p.price),
    new Date().toISOString(),
    ''
  ]);
  logActivity('registerProduct_new', { id, name: p.name, quantity: p.quantity, price: p.price });
  return corsResponse({ success: true, message: 'Product registered', id });
}

// ============================================================
//  EDIT a product (find by id, update name/qty/price)
// ============================================================
function editProduct(p) {
  const sheet = getSheet(SHEET_PRODUCTS);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).toLowerCase().trim());

  const idCol   = headers.indexOf('id');
  const nameCol = headers.indexOf('name');
  const qtyCol  = headers.indexOf('quantity');
  const priceCol= headers.indexOf('price_tzs_');
  const updCol  = headers.indexOf('updated_at');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(p.id)) {
      sheet.getRange(i + 1, nameCol  + 1).setValue(p.name);
      sheet.getRange(i + 1, qtyCol   + 1).setValue(Number(p.quantity));
      sheet.getRange(i + 1, priceCol + 1).setValue(Number(p.price));
      sheet.getRange(i + 1, updCol   + 1).setValue(new Date().toISOString());
      logActivity('editProduct', { id: p.id, name: p.name, quantity: p.quantity, price: p.price });
      return corsResponse({ success: true, message: 'Product updated' });
    }
  }

  return corsResponse({ success: false, error: 'Product ID not found: ' + p.id });
}

// ============================================================
//  DELETE a product (find by id, delete entire row)
// ============================================================
function deleteProduct(p) {
  const sheet = getSheet(SHEET_PRODUCTS);
  const data  = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).toLowerCase().trim());
  const idCol   = headers.indexOf('id');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(p.id)) {
      const name = data[i][headers.indexOf('name')];
      sheet.deleteRow(i + 1);
      logActivity('deleteProduct', { id: p.id, name });
      return corsResponse({ success: true, message: 'Product deleted' });
    }
  }

  return corsResponse({ success: false, error: 'Product ID not found: ' + p.id });
}

// ============================================================
//  RECORD a sale AND deduct stock quantity in Products sheet
// ============================================================
function recordSale(s) {
  // 1. Append to Sales sheet
  const salesSheet = getSheet(SHEET_SALES);
  salesSheet.appendRow([
    s.id || Date.now(),
    s.productId,
    s.productName,
    Number(s.quantity),
    Number(s.costPrice),
    Number(s.sellPrice),
    Number(s.revenue),
    Number(s.profit),
    s.seller,
    s.customer || 'Walk-in Customer',
    s.datetime || new Date().toISOString()
  ]);

  // 2. Deduct from Products sheet
  const prodSheet = getSheet(SHEET_PRODUCTS);
  const data      = prodSheet.getDataRange().getValues();
  const headers   = data[0].map(h => String(h).toLowerCase().trim());
  const idCol     = headers.indexOf('id');
  const qtyCol    = headers.indexOf('quantity');
  const updCol    = headers.indexOf('updated_at');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(s.productId)) {
      const newQty = Math.max(0, Number(data[i][qtyCol]) - Number(s.quantity));
      prodSheet.getRange(i + 1, qtyCol + 1).setValue(newQty);
      prodSheet.getRange(i + 1, updCol + 1).setValue(new Date().toISOString());
      break;
    }
  }

  logActivity('recordSale', { productName: s.productName, quantity: s.quantity, revenue: s.revenue, seller: s.seller });
  return corsResponse({ success: true, message: 'Sale recorded' });
}
